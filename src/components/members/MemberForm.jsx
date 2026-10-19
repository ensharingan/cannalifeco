import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Upload, X, User, RefreshCw, ShieldCheck, ShieldX, ShieldAlert, FileText, ChevronDown, ChevronUp, ExternalLink, FileSignature, Eraser, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

var EMPTY_FORM = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  gender: "male",
  membership_start_date: new Date().toISOString().split("T")[0],
  id_type: "sa_id",
  id_number: "",
  nationality: "South African",
  address: "",
  membership_type: "standard",
  group_affiliation: "",
  notes: "",
  profile_image: "",
  fica_status: "pending",
  fica_id_document: "",
  fica_proof_of_address: "",
  fica_verified_at: null,
  fica_notes: "",
  signature_image: "",
  expiry_date: null,
};

function initForm(member) {
  if (!member) return { ...EMPTY_FORM };
  return {
    first_name: member.first_name || "",
    last_name: member.last_name || "",
    email: member.email || "",
    phone: member.phone || "",
    gender: member.gender || "male",
    membership_start_date: member.membership_start_date || member.date_of_birth || "",
    id_type: member.id_type || "sa_id",
    id_number: member.id_number || "",
    nationality: member.nationality || "South African",
    address: member.address || "",
    membership_type: member.membership_type || "standard",
    group_affiliation: member.group_affiliation || "",
    notes: member.notes || "",
    profile_image: member.profile_image || "",
    fica_status: member.fica_status || "pending",
    fica_id_document: member.fica_id_document || "",
    fica_proof_of_address: member.fica_proof_of_address || "",
    fica_verified_at: member.fica_verified_at || null,
    fica_notes: member.fica_notes || "",
    signature_image: member.signature_image || "",
    expiry_date: member.expiry_date || null,
  };
}

var FICA_STATUS_CONFIG = {
  pending: { label: "Pending", icon: ShieldAlert, color: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  verified: { label: "Verified", icon: ShieldCheck, color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/30" },
  rejected: { label: "Rejected", icon: ShieldX, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30" },
};

export default function MemberForm({ form, setForm, onSave, onCancel, member, isSaving, companyId }) {
  var formData = form || (member ? initForm(member) : { ...EMPTY_FORM });
  var [showCamera, setShowCamera] = useState(false);
  var [cameraReady, setCameraReady] = useState(false);
  var [photoPreview, setPhotoPreview] = useState(formData.profile_image || "");
  var [uploadingPhoto, setUploadingPhoto] = useState(false);
  var [facingMode, setFacingMode] = useState("environment");
  var [availableCameras, setAvailableCameras] = useState([]);
  var [selectedDeviceId, setSelectedDeviceId] = useState("");
  var [isMobile, setIsMobile] = useState(false);
  var videoRef = useRef(null);
  var streamRef = useRef(null);
  var canvasRef = useRef(null);
  var pendingStartRef = useRef(null);

  // FICA section toggle
  var [showFica, setShowFica] = useState(
    !!(formData.fica_id_document || formData.fica_proof_of_address || formData.fica_notes || formData.fica_status === "verified" || formData.fica_status === "rejected")
  );
  var [uploadingFicaId, setUploadingFicaId] = useState(false);
  var [uploadingFicaAddr, setUploadingFicaAddr] = useState(false);

  // ── Membership contract state ──
  var [contract, setContract] = useState(null);
  var [contractEnabled, setContractEnabled] = useState(false);
  var [showContract, setShowContract] = useState(false);
  var [accepted, setAccepted] = useState(!!formData.signature_image);
  var [hasSignature, setHasSignature] = useState(!!formData.signature_image);
  var [uploadingSig, setUploadingSig] = useState(false);
  var sigCanvasRef = useRef(null);
  var sigDrawing = useRef(false);
  var sigDrawn = useRef(false);

  useEffect(function () {
    var mobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(mobile);
  }, []);

  // Load active contract + feature flag for this company
  useEffect(function () {
    if (!companyId) return;
    var cancelled = false;
    (async function () {
      var compRes = await supabase.from("companies").select("features").eq("id", companyId).single();
      var enabled = !!(compRes.data && compRes.data.features && compRes.data.features.membership_contracts);
      if (cancelled) return;
      setContractEnabled(enabled);
      if (!enabled) return;
      var cRes = await supabase
        .from("membership_contracts")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (cRes.data && cRes.data[0]) setContract(cRes.data[0]);
    })();
    return function () { cancelled = true; };
  }, [companyId]);

  var update = function (field, value) {
    if (setForm) {
      setForm(function (prev) { return { ...prev, [field]: value }; });
    }
  };

  var validateSAID = function (id) {
    if (!/^\d{13}$/.test(id)) return false;
    var sum = 0;
    for (var i = 0; i < 13; i++) {
      var digit = parseInt(id[i]);
      if (i % 2 !== 0) { digit *= 2; if (digit > 9) digit -= 9; }
      sum += digit;
    }
    return sum % 10 === 0;
  };

  var isIdValid = function () {
    if (formData.id_type === "none") return true;
    if (!formData.id_number.trim()) return true;
    if (formData.id_type === "sa_id") return validateSAID(formData.id_number);
    return formData.id_number.trim().length >= 3;
  };

  // ── Signature pad ──
  var setupSigCanvas = useCallback(function () {
    var canvas = sigCanvasRef.current;
    if (!canvas) return;
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    var ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  useEffect(function () {
    if (showContract && !hasSignature) {
      setTimeout(setupSigCanvas, 50);
    }
  }, [showContract, hasSignature, setupSigCanvas]);

  var sigPos = function (e) {
    var rect = sigCanvasRef.current.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  var sigStart = function (e) {
    e.preventDefault();
    sigDrawing.current = true;
    sigDrawn.current = true;
    var ctx = sigCanvasRef.current.getContext("2d");
    var p = sigPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  var sigMove = function (e) {
    if (!sigDrawing.current) return;
    e.preventDefault();
    var ctx = sigCanvasRef.current.getContext("2d");
    var p = sigPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  var sigEnd = function () { sigDrawing.current = false; };
  var sigClear = function () {
    var canvas = sigCanvasRef.current;
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sigDrawn.current = false;
  };

  // Compute a renewed expiry from store settings (default 365 days)
  var computeExpiry = async function () {
    var days = 365;
    try {
      var ssRes = await supabase
        .from("store_settings")
        .select("membership_duration_days")
        .eq("company_id", companyId)
        .not("membership_duration_days", "is", null)
        .limit(1);
      if (ssRes.data && ssRes.data[0] && ssRes.data[0].membership_duration_days) {
        days = ssRes.data[0].membership_duration_days;
      }
    } catch (e) { /* default */ }
    var base = new Date();
    var current = formData.expiry_date ? new Date(formData.expiry_date) : null;
    if (current && current > base) base = current;
    base.setDate(base.getDate() + days);
    return base.toISOString().split("T")[0];
  };

  // Capture signature to storage + set fields, returns updated patch
  var captureSignature = async function () {
    if (hasSignature && formData.signature_image) {
      // Already signed (editing existing) — nothing new to capture
      return {};
    }
    if (!sigDrawn.current) return {};
    setUploadingSig(true);
    try {
      var dataUrl = sigCanvasRef.current.toDataURL("image/png");
      // Upload to member-photos bucket
      var blob = await (await fetch(dataUrl)).blob();
      var fileName = "signatures/" + (companyId || "unknown") + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".png";
      var up = await supabase.storage.from("member-photos").upload(fileName, blob, { contentType: "image/png", upsert: false });
      if (up.error) throw up.error;
      var pub = supabase.storage.from("member-photos").getPublicUrl(fileName).data.publicUrl;
      var newExpiry = await computeExpiry();

      var patch = { signature_image: pub, expiry_date: newExpiry };

      // Best-effort audit row (links member_id when editing an existing member)
      try {
        await supabase.from("member_contract_signatures").insert({
          company_id: companyId,
          member_id: member && member.id ? member.id : null,
          contract_id: contract ? contract.id : null,
          contract_version: contract ? contract.version : null,
          signature_image: pub,
          id_document_url: formData.fica_id_document || null,
          profile_image: formData.profile_image || null,
          typed_full_name: (formData.first_name + " " + formData.last_name).trim(),
          signed_via: "in_store",
          previous_expiry_date: formData.expiry_date || null,
          new_expiry_date: newExpiry,
        });
      } catch (e) { /* non-fatal */ }

      return patch;
    } catch (err) {
      toast.error("Signature save failed: " + err.message);
      return {};
    } finally {
      setUploadingSig(false);
    }
  };

  var handleSave = async function () {
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      toast.error("First name and last name are required");
      return;
    }
    if (formData.id_type === "sa_id" && formData.id_number.trim() && !validateSAID(formData.id_number)) {
      toast.error("Invalid SA ID number. Check the digits or switch ID type to Passport.");
      return;
    }

    var patch = {};
    if (contractEnabled && contract && accepted && sigDrawn.current && !formData.signature_image) {
      patch = await captureSignature();
    }

    var finalData = { ...formData, ...patch };
    onSave(finalData);
  };

  var enumerateCameras = async function () {
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      var videoDevices = devices.filter(function (d) { return d.kind === "videoinput"; });
      setAvailableCameras(videoDevices);
      return videoDevices;
    } catch (err) {
      return [];
    }
  };

  var attachStream = useCallback(function (stream) {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(function () {});
      setCameraReady(true);
    }
  }, []);

  useEffect(function () {
    if (showCamera && pendingStartRef.current) {
      var opts = pendingStartRef.current;
      pendingStartRef.current = null;
      setTimeout(function () { openStream(opts.deviceId, opts.facing); }, 100);
    }
  }, [showCamera]);

  var openStream = async function (deviceId, facing) {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(function (t) { t.stop(); });
      streamRef.current = null;
    }
    setCameraReady(false);
    try {
      var constraints = { video: { width: { ideal: 640 }, height: { ideal: 480 } } };
      if (deviceId) {
        constraints.video.deviceId = { exact: deviceId };
      } else if (isMobile) {
        constraints.video.facingMode = { ideal: facing || "environment" };
      } else {
        constraints.video.facingMode = "user";
      }
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      attachStream(stream);
      var cameras = await enumerateCameras();
      if (!deviceId && cameras.length > 0 && !isMobile) {
        var activeTrack = stream.getVideoTracks()[0];
        if (activeTrack) {
          var settings = activeTrack.getSettings();
          if (settings.deviceId) setSelectedDeviceId(settings.deviceId);
        }
      }
    } catch (err) {
      toast.error("Could not access camera. Please allow camera permissions.");
      setShowCamera(false);
    }
  };

  var startCamera = function (deviceId, facing) {
    if (!showCamera) {
      pendingStartRef.current = { deviceId: deviceId || null, facing: facing || facingMode };
      setShowCamera(true);
    } else {
      openStream(deviceId, facing);
    }
  };

  var stopCamera = function () {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(function (t) { t.stop(); });
      streamRef.current = null;
    }
    setCameraReady(false);
    setShowCamera(false);
  };

  var switchCamera = function () {
    if (isMobile) {
      var newFacing = facingMode === "environment" ? "user" : "environment";
      setFacingMode(newFacing);
      openStream(null, newFacing);
    } else {
      if (availableCameras.length <= 1) { toast.info("No other cameras found"); return; }
      var currentIndex = availableCameras.findIndex(function (c) { return c.deviceId === selectedDeviceId; });
      var nextDevice = availableCameras[(currentIndex + 1) % availableCameras.length];
      setSelectedDeviceId(nextDevice.deviceId);
      openStream(nextDevice.deviceId);
    }
  };

  var capturePhoto = async function () {
    if (!videoRef.current || !canvasRef.current) return;
    var video = videoRef.current;
    var canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    stopCamera();
    canvas.toBlob(async function (blob) {
      if (!blob) return;
      await uploadPhoto(blob);
    }, "image/jpeg", 0.85);
  };

  var handleFileUpload = async function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    await uploadPhoto(file);
  };

  var uploadPhoto = async function (fileOrBlob) {
    setUploadingPhoto(true);
    try {
      var ext = fileOrBlob.type === "image/png" ? "png" : "jpg";
      var fileName = (companyId || "unknown") + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      var uploadRes = await supabase.storage.from("member-photos").upload(fileName, fileOrBlob, { contentType: fileOrBlob.type, upsert: false });
      if (uploadRes.error) throw uploadRes.error;
      var urlRes = supabase.storage.from("member-photos").getPublicUrl(fileName);
      var publicUrl = urlRes.data.publicUrl;
      setPhotoPreview(publicUrl);
      update("profile_image", publicUrl);
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error("Failed to upload photo: " + err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  var removePhoto = function () {
    setPhotoPreview("");
    update("profile_image", "");
  };

  // ── FICA document upload ──
  var uploadFicaDoc = async function (file, field, setUploading) {
    if (!file) return;
    var allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Please upload an image (JPG/PNG) or PDF");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Maximum 10MB.");
      return;
    }
    setUploading(true);
    try {
      var ext = file.name.split(".").pop() || "pdf";
      var fileName = "fica/" + (companyId || "unknown") + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      var uploadRes = await supabase.storage.from("member-photos").upload(fileName, file, { contentType: file.type, upsert: false });
      if (uploadRes.error) throw uploadRes.error;
      var urlRes = supabase.storage.from("member-photos").getPublicUrl(fileName);
      var publicUrl = urlRes.data.publicUrl;
      update(field, publicUrl);
      toast.success("Document uploaded");
    } catch (err) {
      toast.error("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  var handleFicaStatusChange = function (newStatus) {
    update("fica_status", newStatus);
    if (newStatus === "verified") {
      update("fica_verified_at", new Date().toISOString());
    } else {
      update("fica_verified_at", null);
    }
  };

  var ficaCfg = FICA_STATUS_CONFIG[formData.fica_status] || FICA_STATUS_CONFIG.pending;
  var FicaIcon = ficaCfg.icon;

  useEffect(function () {
    return function () {
      if (streamRef.current) streamRef.current.getTracks().forEach(function (t) { t.stop(); });
    };
  }, []);

  var getCameraLabel = function () {
    if (isMobile) return facingMode === "environment" ? "Rear Camera" : "Front Camera";
    if (selectedDeviceId && availableCameras.length > 0) {
      var cam = availableCameras.find(function (c) { return c.deviceId === selectedDeviceId; });
      if (cam && cam.label) return cam.label.substring(0, 30);
    }
    return "Webcam";
  };

  var renderContractBody = function (body) {
    return String(body || "").split("\n").map(function (line, i) {
      if (line.indexOf("## ") === 0) {
        return <p key={i} className="font-bold text-foreground mt-3 mb-1">{line.slice(3)}</p>;
      }
      if (line.trim() === "") return <div key={i} className="h-1.5" />;
      var bold = line.indexOf("**") === 0 && line.lastIndexOf("**") === line.length - 2;
      return <p key={i} className={bold ? "font-bold text-foreground my-1" : "my-1"}>{bold ? line.slice(2, -2) : line}</p>;
    });
  };

  var contractSigned = !!formData.signature_image || (accepted && sigDrawn.current);

  return (
    <div className="space-y-4">
      {/* Profile Photo */}
      <div className="flex flex-col items-center gap-3 pb-3 border-b border-border">
        <div className="relative w-24 h-24 rounded-full overflow-hidden bg-muted border-2 border-border">
          {photoPreview ? (
            <>
              <img src={photoPreview} alt="Member" className="w-full h-full object-cover" />
              <button onClick={removePhoto} className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center">
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <User className="w-10 h-10 text-muted-foreground" />
            </div>
          )}
        </div>

        {showCamera ? (
          <div className="w-full space-y-2">
            <div className="relative">
              <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg border border-border bg-black" style={{ minHeight: "200px" }} />
              {cameraReady && <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">{getCameraLabel()}</div>}
              {!cameraReady && <div className="absolute inset-0 flex items-center justify-center text-white text-sm">Starting camera...</div>}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <div className="flex gap-2">
              <Button onClick={capturePhoto} className="flex-1" size="sm" disabled={!cameraReady}>
                <Camera className="w-4 h-4 mr-1" /> Capture
              </Button>
              <Button onClick={switchCamera} variant="outline" size="sm" disabled={!cameraReady}><RefreshCw className="w-4 h-4" /></Button>
              <Button onClick={stopCamera} variant="outline" size="sm">Cancel</Button>
            </div>
            {!isMobile && availableCameras.length > 1 && (
              <select value={selectedDeviceId} onChange={function (e) { setSelectedDeviceId(e.target.value); openStream(e.target.value); }}
                className="w-full text-xs p-2 rounded border border-border bg-background text-foreground">
                {availableCameras.map(function (cam, idx) {
                  return <option key={cam.deviceId} value={cam.deviceId}>{cam.label || "Camera " + (idx + 1)}</option>;
                })}
              </select>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={function () { startCamera(); }} variant="outline" size="sm" disabled={uploadingPhoto}>
              <Camera className="w-4 h-4 mr-1" /> Take Photo
            </Button>
            <label>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              <Button variant="outline" size="sm" asChild disabled={uploadingPhoto}>
                <span><Upload className="w-4 h-4 mr-1" />{uploadingPhoto ? "Uploading..." : "Upload"}</span>
              </Button>
            </label>
          </div>
        )}
      </div>

      {/* Name */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>First Name *</Label>
          <Input value={formData.first_name} onChange={function (e) { update("first_name", e.target.value); }} placeholder="First name" />
        </div>
        <div>
          <Label>Last Name *</Label>
          <Input value={formData.last_name} onChange={function (e) { update("last_name", e.target.value); }} placeholder="Last name" />
        </div>
      </div>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Email</Label>
          <Input type="email" value={formData.email} onChange={function (e) { update("email", e.target.value); }} placeholder="Optional" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={formData.phone} onChange={function (e) { update("phone", e.target.value); }} placeholder="Optional" />
        </div>
      </div>

      {/* ID */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>ID Type</Label>
          <Select value={formData.id_type} onValueChange={function (v) { update("id_type", v); if (v === "none") update("id_number", ""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sa_id">SA ID Number</SelectItem>
              <SelectItem value="passport">Passport</SelectItem>
              <SelectItem value="asylum_permit">Asylum Permit</SelectItem>
              <SelectItem value="other">Other</SelectItem>
              <SelectItem value="none">No ID</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>
            {formData.id_type === "sa_id" ? "SA ID Number" :
             formData.id_type === "passport" ? "Passport Number" :
             formData.id_type === "asylum_permit" ? "Permit Number" :
             formData.id_type === "none" ? "N/A" : "ID Number"}
          </Label>
          <Input
            value={formData.id_number}
            onChange={function (e) { update("id_number", e.target.value); }}
            placeholder={formData.id_type === "sa_id" ? "13-digit SA ID" : formData.id_type === "passport" ? "Passport number" : formData.id_type === "none" ? "Not required" : "ID number"}
            disabled={formData.id_type === "none"}
            maxLength={formData.id_type === "sa_id" ? 13 : 50}
          />
          {formData.id_type === "sa_id" && formData.id_number.trim() && !validateSAID(formData.id_number) && (
            <p className="text-xs text-red-500 mt-1">Invalid SA ID number</p>
          )}
        </div>
      </div>

      {/* Gender, Start Date, Nationality */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Gender</Label>
          <Select value={formData.gender} onValueChange={function (v) { update("gender", v); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Membership Start Date</Label>
          <Input type="date" value={formData.membership_start_date} onChange={function (e) { update("membership_start_date", e.target.value); }} />
        </div>
        <div>
          <Label>Nationality</Label>
          <Input value={formData.nationality} onChange={function (e) { update("nationality", e.target.value); }} placeholder="e.g. South African" />
        </div>
      </div>

      {/* Address */}
      <div>
        <Label>Address</Label>
        <Input value={formData.address} onChange={function (e) { update("address", e.target.value); }} placeholder="Optional" />
      </div>

      {/* Group Affiliation */}
      <div>
        <Label>Group Affiliation</Label>
        <Input value={formData.group_affiliation} onChange={function (e) { update("group_affiliation", e.target.value); }} placeholder="Optional" />
      </div>

      {/* Notes */}
      <div>
        <Label>Notes</Label>
        <Textarea value={formData.notes} onChange={function (e) { update("notes", e.target.value); }} placeholder="Optional notes about this member" rows={3} />
      </div>

      {/* ── FICA Section (collapsible) ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        {/* Header / toggle */}
        <button
          type="button"
          onClick={function () { setShowFica(!showFica); }}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FicaIcon className={cn("w-4 h-4", ficaCfg.color)} />
            <span className="text-sm font-semibold">FICA Compliance</span>
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", ficaCfg.bg, ficaCfg.color, ficaCfg.border)}>
              {ficaCfg.label}
            </span>
            <span className="text-xs text-muted-foreground font-normal">— Optional</span>
          </div>
          {showFica
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          }
        </button>

        {showFica && (
          <div className="p-4 space-y-4 border-t border-border">

            {/* FICA Status */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Verification Status</Label>
              <div className="flex gap-2">
                {Object.entries(FICA_STATUS_CONFIG).map(function (entry) {
                  var key = entry[0];
                  var cfg = entry[1];
                  var Icon = cfg.icon;
                  var isSelected = formData.fica_status === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={function () { handleFicaStatusChange(key); }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-semibold transition-all",
                        isSelected
                          ? cn(cfg.bg, cfg.color, cfg.border)
                          : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
              {formData.fica_status === "verified" && formData.fica_verified_at && (
                <p className="text-xs text-green-500 mt-1.5">
                  ✓ Verified on {new Date(formData.fica_verified_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
            </div>

            {/* ID Document upload */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">ID Document <span className="text-muted-foreground/60">(JPG, PNG or PDF · max 10MB)</span></Label>
              {formData.fica_id_document ? (
                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-green-500/30 bg-green-500/5">
                  <FileText className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-xs text-green-600 flex-1 truncate">Document uploaded</span>
                  <a href={formData.fica_id_document} target="_blank" rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-0.5">
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                  <button type="button" onClick={function () { update("fica_id_document", ""); }}
                    className="text-muted-foreground hover:text-red-500 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 w-full cursor-pointer">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={function (e) {
                      var file = e.target.files && e.target.files[0];
                      if (file) uploadFicaDoc(file, "fica_id_document", setUploadingFicaId);
                      e.target.value = "";
                    }}
                  />
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all w-full text-xs text-muted-foreground",
                    uploadingFicaId && "opacity-60 pointer-events-none"
                  )}>
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    {uploadingFicaId ? "Uploading..." : "Upload ID document"}
                  </div>
                </label>
              )}
            </div>

            {/* Proof of address upload */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Proof of Address <span className="text-muted-foreground/60">(JPG, PNG or PDF · max 10MB)</span></Label>
              {formData.fica_proof_of_address ? (
                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-green-500/30 bg-green-500/5">
                  <FileText className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-xs text-green-600 flex-1 truncate">Document uploaded</span>
                  <a href={formData.fica_proof_of_address} target="_blank" rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-0.5">
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                  <button type="button" onClick={function () { update("fica_proof_of_address", ""); }}
                    className="text-muted-foreground hover:text-red-500 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 w-full cursor-pointer">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={function (e) {
                      var file = e.target.files && e.target.files[0];
                      if (file) uploadFicaDoc(file, "fica_proof_of_address", setUploadingFicaAddr);
                      e.target.value = "";
                    }}
                  />
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all w-full text-xs text-muted-foreground",
                    uploadingFicaAddr && "opacity-60 pointer-events-none"
                  )}>
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    {uploadingFicaAddr ? "Uploading..." : "Upload proof of address"}
                  </div>
                </label>
              )}
            </div>

            {/* FICA Notes */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">FICA Notes</Label>
              <Textarea
                value={formData.fica_notes}
                onChange={function (e) { update("fica_notes", e.target.value); }}
                placeholder="e.g. Passport pending renewal, re-verify by Aug 2026..."
                rows={2}
                className="text-sm"
              />
            </div>

          </div>
        )}
      </div>

      {/* ── Membership Agreement (collapsible, only if enabled + contract exists) ── */}
      {contractEnabled && contract && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={function () { setShowContract(!showContract); }}
            className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileSignature className={cn("w-4 h-4", contractSigned ? "text-green-500" : "text-yellow-500")} />
              <span className="text-sm font-semibold">Membership Agreement</span>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                contractSigned ? "bg-green-500/10 text-green-500 border-green-500/30" : "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
              )}>
                {contractSigned ? "Signed" : "Not signed"}
              </span>
              <span className="text-xs text-muted-foreground font-normal">— Optional</span>
            </div>
            {showContract
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />
            }
          </button>

          {showContract && (
            <div className="p-4 space-y-4 border-t border-border">
              {hasSignature && formData.signature_image ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="w-4 h-4" /> This member has already signed the agreement.
                  </div>
                  <img src={formData.signature_image} alt="Signature" className="h-24 border border-border rounded-lg bg-white p-2" />
                  {formData.expiry_date && (
                    <p className="text-xs text-muted-foreground">Membership valid until {formData.expiry_date}</p>
                  )}
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={function () { setHasSignature(false); update("signature_image", ""); sigDrawn.current = false; setTimeout(setupSigCanvas, 50); }}
                  >
                    Re-sign / renew
                  </Button>
                </div>
              ) : (
                <>
                  <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground leading-relaxed">
                    <p className="font-bold text-sm mb-2">{contract.title}</p>
                    {renderContractBody(contract.body)}
                  </div>

                  <label className="flex items-start gap-2 text-xs text-foreground">
                    <input type="checkbox" className="mt-0.5" checked={accepted} onChange={function (e) { setAccepted(e.target.checked); }} />
                    <span>Member confirms they are 18+ and agree to the {contract.title}, and consent to processing of their personal information for membership administration.</span>
                  </label>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs text-muted-foreground">Signature</Label>
                      <button type="button" onClick={sigClear} className="text-xs text-muted-foreground flex items-center gap-1">
                        <Eraser className="w-3 h-3" /> Clear
                      </button>
                    </div>
                    <canvas
                      ref={sigCanvasRef}
                      className="w-full h-32 rounded-lg border-2 border-dashed border-border bg-white touch-none"
                      onMouseDown={sigStart} onMouseMove={sigMove} onMouseUp={sigEnd} onMouseLeave={sigEnd}
                      onTouchStart={sigStart} onTouchMove={sigMove} onTouchEnd={sigEnd}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Sign with finger or mouse. Captured when you save. Extends membership from the store's duration.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1" disabled={isSaving || uploadingSig}>Cancel</Button>
        <Button onClick={handleSave} className="flex-1" disabled={isSaving || uploadingSig || !formData.first_name.trim() || !formData.last_name.trim() || !isIdValid()}>
          {uploadingSig ? "Saving signature..." : isSaving ? "Saving..." : member ? "Update Member" : "Create Member"}
        </Button>
      </div>
    </div>
  );
}

export { EMPTY_FORM, initForm };
