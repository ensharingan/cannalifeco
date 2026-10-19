import { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { ArrowLeft, Shield, Send, CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function DataSubjectRequest() {
  var navigate = useNavigate();
  var [submitted, setSubmitted] = useState(false);
  var [isSaving, setIsSaving] = useState(false);
  var [form, setForm] = useState({
    request_type: "access",
    requester_name: "",
    requester_email: "",
    requester_phone: "",
    description: "",
  });

  var handleChange = function (e) {
    setForm(function (prev) { return { ...prev, [e.target.name]: e.target.value }; });
  };

  var handleSubmit = async function (e) {
    e.preventDefault();
    if (!form.requester_name.trim() || !form.requester_email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setIsSaving(true);
    try {
      var res = await supabase.from("data_subject_requests").insert([{
        request_type: form.request_type,
        requester_name: form.requester_name.trim(),
        requester_email: form.requester_email.trim(),
        requester_phone: form.requester_phone.trim() || null,
        description: form.description.trim() || null,
        status: "pending",
      }]);
      if (res.error) throw res.error;
      setSubmitted(true);
    } catch (err) {
      toast.error("Failed to submit request: " + (err.message || "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <CheckCircle className="w-16 h-16 text-green-600 mx-auto" />
          <h1 className="text-2xl font-bold">Request Submitted</h1>
          <p className="text-muted-foreground">Your data subject request has been received. We will respond within 30 days as required by POPIA. You will receive a response at {form.requester_email}.</p>
          <Button onClick={function () { navigate("/"); }} className="mt-4">Return to Canna Life Co</Button>
        </div>
      </div>
    );
  }

  var requestTypes = [
    { value: "access", label: "Access My Data", desc: "Request a copy of all personal information we hold about you (Section 23)" },
    { value: "correction", label: "Correct My Data", desc: "Request correction of inaccurate or outdated information (Section 24)" },
    { value: "deletion", label: "Delete My Data", desc: "Request deletion of your personal information (Section 24)" },
    { value: "objection", label: "Object to Processing", desc: "Object to the processing of your personal information (Section 11(3))" },
    { value: "portability", label: "Export My Data", desc: "Request your data in a portable format (CSV)" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <button onClick={function () { navigate(-1); }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-8 h-8 text-green-600" />
          <h1 className="text-2xl font-bold">Data Subject Request</h1>
        </div>
        <p className="text-muted-foreground mb-8 text-sm">Exercise your rights under the Protection of Personal Information Act (POPIA). We will respond within 30 days.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Request Type</Label>
            <div className="space-y-2">
              {requestTypes.map(function (rt) {
                return (
                  <label key={rt.value}
                    className={"flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors " +
                      (form.request_type === rt.value ? "border-green-600 bg-green-600/5" : "border-border hover:border-muted-foreground/30")}>
                    <input type="radio" name="request_type" value={rt.value} checked={form.request_type === rt.value}
                      onChange={handleChange} className="mt-1 accent-green-600" />
                    <div>
                      <p className="text-sm font-medium">{rt.label}</p>
                      <p className="text-xs text-muted-foreground">{rt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="requester_name">Full Name *</Label>
              <Input id="requester_name" name="requester_name" value={form.requester_name} onChange={handleChange} placeholder="Your full name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="requester_email">Email Address *</Label>
              <Input id="requester_email" name="requester_email" type="email" value={form.requester_email} onChange={handleChange} placeholder="your@email.com" required />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="requester_phone">Phone Number (Optional)</Label>
            <Input id="requester_phone" name="requester_phone" value={form.requester_phone} onChange={handleChange} placeholder="072 123 4567" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Additional Details</Label>
            <Textarea id="description" name="description" value={form.description} onChange={handleChange}
              placeholder="Provide any additional context for your request, e.g. which data you'd like corrected, which account you're referring to, etc."
              rows={4} />
          </div>

          <div className="bg-muted/50 rounded-lg p-4 text-xs text-muted-foreground">
            <p>By submitting this request, you confirm that you are the data subject or an authorised representative. We may need to verify your identity before processing your request. Your request will be handled in accordance with POPIA and we will respond within 30 days.</p>
          </div>

          <Button type="submit" disabled={isSaving} className="w-full gap-2">
            <Send className="w-4 h-4" />
            {isSaving ? "Submitting..." : "Submit Request"}
          </Button>
        </form>
      </div>
    </div>
  );
}
