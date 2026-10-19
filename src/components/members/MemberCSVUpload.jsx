import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X, Loader2, Download } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "@/lib/CompanyContext";
import { toast } from "sonner";

var VALID_TYPES = ["standard", "premium", "vip", "founder", "basic", "lounge"];

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function mapHeader(raw) {
  var n = normalizeHeader(raw);
  var map = {
    "first name": "first_name",
    "last name": "last_name",
    "sa id": "id_number",
    "id number": "id_number",
    "id": "id_number",
    "sa id number": "id_number",
    "email": "email",
    "phone": "phone",
    "type": "membership_type",
    "membership type": "membership_type",
    "branch": "branch",
    "member": "membership_id",
    "member #": "membership_id",
    "registered at": "registered_at",
    "expires at": "expires_at",
  };
  return map[n] || null;
}

function parseCSV(text) {
  var rows = [];
  var current = "";
  var inQuotes = false;
  var chars = text.split("");

  for (var i = 0; i < chars.length; i++) {
    var c = chars[i];
    if (c === '"') {
      if (inQuotes && chars[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === "\n" || (c === "\r" && chars[i + 1] === "\n")) && !inQuotes) {
      if (c === "\r") i++;
      rows.push(current);
      current = "";
    } else if (c === "\r" && !inQuotes) {
      rows.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) rows.push(current);

  return rows.map(function (row) {
    var fields = [];
    var field = "";
    var q = false;
    for (var j = 0; j < row.length; j++) {
      var ch = row[j];
      if (ch === '"') {
        q = !q;
      } else if (ch === "," && !q) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  });
}

function cleanSAID(val) {
  if (!val) return null;
  return val.replace(/^="?/, "").replace(/"?$/, "").trim() || null;
}

function generateMembershipId() {
  var year = new Date().getFullYear();
  var rand = Math.floor(Math.random() * 999999).toString().padStart(6, "0");
  return "MEM-" + year + "-" + rand;
}

function downloadTemplate() {
  var header = "First Name,Last Name,ID Number,Email,Phone,Type";
  var example1 = "John,Doe,9501015800086,john@example.com,0821234567,standard";
  var example2 = "Jane,Smith,9805210300081,jane@example.com,0839876543,premium";
  var csv = header + "\n" + example1 + "\n" + example2 + "\n";
  var blob = new Blob([csv], { type: "text/csv" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "member_import_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function MemberCSVUpload({ onComplete }) {
  var companyData = useCompany();
  var companyId = companyData.companyId;
  var fileRef = useRef(null);
  var isCancelled = useRef(false);
  var _step = useState("idle");
  var step = _step[0];
  var setStep = _step[1];
  var _file = useState(null);
  var file = _file[0];
  var setFile = _file[1];
  var _preview = useState(null);
  var preview = _preview[0];
  var setPreview = _preview[1];
  var _progress = useState({ done: 0, total: 0, errors: [] });
  var progress = _progress[0];
  var setProgress = _progress[1];

  var handleFile = function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.name.endsWith(".csv")) {
      toast.error("Please upload a .csv file");
      return;
    }
    setFile(f);

    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var text = ev.target.result;
        var parsed = parseCSV(text);
        if (parsed.length < 2) {
          toast.error("CSV has no data rows");
          return;
        }

        var rawHeaders = parsed[0];
        var mappedHeaders = rawHeaders.map(mapHeader);
        var dataRows = parsed.slice(1).filter(function (r) {
          return r.some(function (c) { return c.trim(); });
        });

        var errors = [];
        if (mappedHeaders.indexOf("first_name") === -1) {
          errors.push("Missing required column: First Name");
        }
        if (mappedHeaders.indexOf("last_name") === -1) {
          errors.push("Missing required column: Last Name");
        }

        var members = dataRows.map(function (row) {
          var obj = {};
          mappedHeaders.forEach(function (key, i) {
            if (key) obj[key] = (row[i] && row[i].trim()) || null;
          });
          return obj;
        });

        // Filter out instruction/empty rows
        members = members.filter(function (m) {
          return m.first_name && m.first_name.length > 0 && m.first_name !== "Instructions:";
        });

        // Validate and fix membership_type
        members.forEach(function (m) {
          if (m.membership_type) {
            m.membership_type = m.membership_type.toLowerCase().trim();
          }
          if (!m.membership_type || VALID_TYPES.indexOf(m.membership_type) === -1) {
            m.membership_type = "standard";
          }
        });

        // Deduplicate by SA ID or name+phone
        var deduped = new Map();
        members.forEach(function (m) {
          var key = m.id_number
            ? cleanSAID(m.id_number)
            : m.first_name + "-" + m.last_name + "-" + (m.phone || "");
          deduped.set(key, m);
        });

        var uniqueMembers = Array.from(deduped.values());
        var dupCount = members.length - uniqueMembers.length;

        setPreview({
          rawHeaders: rawHeaders,
          mappedHeaders: mappedHeaders,
          rows: uniqueMembers,
          totalRaw: dataRows.length,
          dupCount: dupCount,
          errors: errors,
        });
        setStep("preview");
      } catch (err) {
        toast.error("Failed to parse CSV: " + err.message);
      }
    };
    reader.readAsText(f);
  };

  var handleImport = async function () {
    if (!preview || !companyId) return;
    isCancelled.current = false;
    setStep("importing");
    setProgress({ done: 0, total: preview.rows.length, errors: [] });

    var BATCH = 25;
    var errors = [];
    var done = 0;

    for (var i = 0; i < preview.rows.length; i += BATCH) {
      if (isCancelled.current) break;

      var batch = preview.rows.slice(i, i + BATCH).map(function (m) {
        return {
          company_id: companyId,
          first_name: m.first_name || "Unknown",
          last_name: m.last_name || "Unknown",
          email: m.email || null,
          phone: m.phone || null,
          id_number: m.id_number || null,
          membership_type: m.membership_type || "standard",
          membership_id: m.membership_id || generateMembershipId(),
          is_active: true,
          is_banned: false,
          registration_status: "approved",
          loyalty_points: 0,
          total_spend: 0,
          visit_count: 0,
          date_of_birth: null,
          store_credit: 0,
        };
      });

      // Insert one by one to handle individual errors gracefully
      for (var j = 0; j < batch.length; j++) {
        if (isCancelled.current) break;
        try {
          var result = await supabase.from("members").insert(batch[j]);
          if (result.error) {
            errors.push(batch[j].first_name + " " + batch[j].last_name + ": " + result.error.message);
          } else {
            done++;
          }
        } catch (err) {
          errors.push(batch[j].first_name + " " + batch[j].last_name + ": " + err.message);
        }
      }

      setProgress({ done: done, total: preview.rows.length, errors: errors });
    }

    if (!isCancelled.current) {
      setProgress(function (p) { return { done: done, total: p.total, errors: errors }; });
      setStep("done");
      toast.success("Imported " + done + " members" + (errors.length ? " (" + errors.length + " errors)" : ""));
    }
  };

  var reset = function () {
    isCancelled.current = true;
    setStep("idle");
    setFile(null);
    setPreview(null);
    setProgress({ done: 0, total: 0, errors: [] });
    if (fileRef.current) fileRef.current.value = "";
  };

  var handleDone = function () {
    reset();
    if (onComplete) onComplete();
  };

  return (
    <div className="space-y-4">
      {step === "idle" && (
        <div className="space-y-3">
          <div
            className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-green-500 hover:bg-green-500/5 transition-colors"
            onClick={function () { if (fileRef.current) fileRef.current.click(); }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFile}
            />
            <Upload className="mx-auto h-10 w-10 text-gray-400 mb-3" />
            <p className="text-sm text-gray-300 font-medium">Click to upload a CSV file</p>
            <p className="text-xs text-gray-500 mt-1">
              Required: First Name, Last Name. Optional: ID Number, Email, Phone, Type
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={downloadTemplate}
          >
            <Download className="h-3 w-3" />
            Download CSV Template
          </Button>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-green-400" />
              <span className="font-medium text-sm">{file ? file.name : ""}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {preview.errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 text-red-400 text-sm font-medium mb-1">
                <AlertCircle className="h-4 w-4" />
                <span>Validation Errors</span>
              </div>
              {preview.errors.map(function (e, i) {
                return <p key={i} className="text-xs text-red-300 ml-6">{e}</p>;
              })}
            </div>
          )}

          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Total rows: </span>
                <span className="text-white font-medium">{preview.totalRaw}</span>
              </div>
              <div>
                <span className="text-gray-400">After dedup: </span>
                <span className="text-white font-medium">{preview.rows.length}</span>
              </div>
              {preview.dupCount > 0 && (
                <div className="col-span-2">
                  <span className="text-yellow-400 text-xs">
                    {preview.dupCount + " duplicate(s) removed (by ID Number)"}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-3">
              <p className="text-xs text-gray-400 mb-1">Detected columns:</p>
              <div className="flex flex-wrap gap-1">
                {preview.rawHeaders.map(function (h, i) {
                  return (
                    <span
                      key={i}
                      className={
                        "text-xs px-2 py-0.5 rounded " +
                        (preview.mappedHeaders[i]
                          ? "bg-green-500/20 text-green-300"
                          : "bg-gray-700 text-gray-500")
                      }
                    >
                      {h + (preview.mappedHeaders[i] ? " \u2713" : " (skipped)")}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <p className="text-xs text-gray-400 mb-1">Preview (first 5):</p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left p-1">Name</th>
                      <th className="text-left p-1">Phone</th>
                      <th className="text-left p-1">Email</th>
                      <th className="text-left p-1">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map(function (m, i) {
                      return (
                        <tr key={i} className="border-b border-gray-800">
                          <td className="p-1 text-white">{m.first_name + " " + m.last_name}</td>
                          <td className="p-1 text-gray-300">{m.phone || "\u2014"}</td>
                          <td className="p-1 text-gray-300">{m.email || "\u2014"}</td>
                          <td className="p-1 text-gray-300">{m.membership_type || "standard"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={preview.errors.length > 0}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              {"Import " + preview.rows.length + " Members"}
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Importing members...</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-300"
              style={{
                width: (progress.total ? (progress.done / progress.total) * 100 : 0) + "%",
              }}
            />
          </div>
          <p className="text-xs text-gray-400">
            {progress.done + " / " + progress.total + " members"}
          </p>
          {progress.errors.length > 0 && (
            <p className="text-xs text-red-400">
              {progress.errors.length + " error(s) so far"}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={reset} className="w-full text-xs">
            Cancel Import
          </Button>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Import Complete</span>
          </div>
          <p className="text-sm text-gray-300">
            {"Successfully imported " + progress.done + " of " + progress.total + " members."}
          </p>
          {progress.errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 max-h-40 overflow-y-auto">
              <p className="text-xs text-red-400 font-medium mb-1">
                {progress.errors.length + " error(s):"}
              </p>
              {progress.errors.map(function (e, i) {
                return <p key={i} className="text-xs text-red-300">{e}</p>;
              })}
            </div>
          )}
          <Button onClick={handleDone} className="w-full bg-green-600 hover:bg-green-700">
            Done
          </Button>
        </div>
      )}

      {step === "error" && (
        <div className="text-center py-4">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400 mb-2" />
          <p className="text-sm text-red-300">Something went wrong</p>
          <Button variant="outline" onClick={reset} className="mt-3">
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
