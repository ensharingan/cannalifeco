import { useState, useCallback } from "react";
import { supabase } from '@/api/supabaseClient';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import SignaturePad from "../components/intake/SignaturePad";
import { CheckCircle2, ChevronRight, ChevronLeft, Leaf } from "lucide-react";
import { useCompany } from "../lib/CompanyContext";

const STEPS = [
  "Patient Details",
  "Medical Information",
  "Informed Consent",
  "POPIA Consent",
  "Supporting Documents",
  "Signature",
];

const defaultForm = {
  title: "", first_name: "", surname: "", id_number: "", age: "", gender: "",
  weight: "", height: "", occupation: "", residential_address: "", work_address: "",
  email: "", phone_number: "",
  diagnosis: "", current_treatment: "", other_conditions: "",
  smoking_cannabis: "", other_cannabis_use: "", cannabis_use_details: "",
  consent_acknowledgement: false, consent_unregistered: false,
  consent_monitoring: false, consent_stop: false,
  popia_consent: false, popia_rights: false,
  id_file: null,
  full_name_signature: "", digital_signature: null,
  date_signed: new Date().toISOString().split("T")[0],
};

export default function PatientIntakeForm() {
  const { companyId } = useCompany();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [errors, setErrors] = useState({});

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const validate = () => {
    const e = {};
    if (step === 0) {
      if (!form.first_name.trim()) e.first_name = "Required";
      if (!form.surname.trim()) e.surname = "Required";
      if (!form.id_number.trim()) e.id_number = "Required";
      if (!form.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) e.email = "Valid email required";
      if (!form.phone_number.trim()) e.phone_number = "Required";
    }
    if (step === 1) {
      if (!form.diagnosis.trim()) e.diagnosis = "Required";
    }
    if (step === 2) {
      if (!form.consent_acknowledgement) e.consent_acknowledgement = "Required";
      if (!form.consent_unregistered) e.consent_unregistered = "Required";
      if (!form.consent_monitoring) e.consent_monitoring = "Required";
      if (!form.consent_stop) e.consent_stop = "Required";
    }
    if (step === 3) {
      if (!form.popia_consent) e.popia_consent = "Required";
      if (!form.popia_rights) e.popia_rights = "Required";
    }
    if (step === 4) {
      if (!form.id_file) e.id_file = "Required";
    }
    if (step === 5) {
      if (!form.full_name_signature.trim()) e.full_name_signature = "Required";
      if (!form.digital_signature) e.digital_signature = "Signature required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validate()) setStep(s => s + 1); };
  const back = () => setStep(s => s - 1);

  const handleSignature = useCallback((dataUrl) => set("digital_signature", dataUrl), []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
    set("id_file", file);
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);

    try {
      // Upload ID document
      let id_upload_url = "";
      if (form.id_file) {
        const uploadPath = `uploads/${Date.now()}_${form.id_file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(uploadPath, form.id_file, { upsert: true });
        if (uploadError) {
          toast.error("Failed to upload ID document. Please try again.");
          setSubmitting(false);
          return;
        }
        id_upload_url = `https://ngblyttszqhgkxmeacmp.supabase.co/storage/v1/object/public/documents/${uploadPath}`;
      }

      // Upload signature
      let digital_signature_url = "";
      if (form.digital_signature) {
        const blob = await fetch(form.digital_signature).then(r => r.blob());
        const sigFile = new File([blob], "signature.png", { type: "image/png" });
        const uploadPath = `uploads/${Date.now()}_signature.png`;
        const { error: sigError } = await supabase.storage
          .from('documents')
          .upload(uploadPath, sigFile, { upsert: true });
        if (sigError) {
          toast.error("Failed to upload signature. Please try again.");
          setSubmitting(false);
          return;
        }
        digital_signature_url = `https://ngblyttszqhgkxmeacmp.supabase.co/storage/v1/object/public/documents/${uploadPath}`;
      }

      // Generate patient ID (scoped to company, with unique fragment)
      const { count } = await supabase
        .from('patients')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      const nextNum = String((count ?? 0) + 1).padStart(5, "0");
      const pid = `S21-${Date.now().toString(36).toUpperCase().slice(-4)}-${nextNum}`;

      // Insert patient record
      const { error: insertError } = await supabase
        .from('patients')
        .insert({
          patient_id: pid,
          company_id: companyId,
          title: form.title,
          first_name: form.first_name,
          surname: form.surname,
          id_number: form.id_number,
          age: form.age ? Number(form.age) : null,
          gender: form.gender,
          weight: form.weight ? Number(form.weight) : null,
          height: form.height ? Number(form.height) : null,
          occupation: form.occupation,
          residential_address: form.residential_address,
          work_address: form.work_address,
          email: form.email,
          phone_number: form.phone_number,
          diagnosis: form.diagnosis,
          current_treatment: form.current_treatment,
          other_conditions: form.other_conditions,
          smoking_cannabis: form.smoking_cannabis,
          other_cannabis_use: form.other_cannabis_use,
          cannabis_use_details: form.other_cannabis_use === "Yes" ? form.cannabis_use_details : "",
          consent_acknowledgement: form.consent_acknowledgement,
          consent_unregistered: form.consent_unregistered,
          consent_monitoring: form.consent_monitoring,
          consent_stop: form.consent_stop,
          popia_consent: form.popia_consent,
          popia_rights: form.popia_rights,
          id_upload_url,
          full_name_signature: form.full_name_signature,
          digital_signature_url,
          date_signed: form.date_signed,
          application_status: "Submitted",
          submission_timestamp: new Date().toISOString(),
          tags: "Section21 Application",
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        toast.error(`Submission failed: ${insertError.message}`);
        setSubmitting(false);
        return;
      }

      setPatientId(pid);
      setSubmitted(true);
    } catch (err) {
      console.error("Submission error:", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Application Submitted!</h2>
            <p className="text-muted-foreground mt-2">Your Section 21 application has been received.</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-6">
            <p className="text-sm text-muted-foreground">Your Patient ID</p>
            <p className="text-3xl font-bold text-primary mt-1">{patientId}</p>
            <p className="text-xs text-muted-foreground mt-3">A confirmation email has been sent to <strong>{form.email}</strong></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Leaf className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-base">Section 21 Patient Intake Form</h1>
            <p className="text-xs text-muted-foreground">Medical Cannabis Application</p>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">Step {step + 1} of {STEPS.length}</span>
            <span className="text-xs font-semibold text-primary">{STEPS[step]}</span>
          </div>
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? "bg-primary" : "bg-border"}`} />
            ))}
          </div>
        </div>
      </div>

      {/* Form body */}
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {step === 0 && <Step1 form={form} set={set} errors={errors} />}
        {step === 1 && <Step2 form={form} set={set} errors={errors} />}
        {step === 2 && <Step3 form={form} set={set} errors={errors} />}
        {step === 3 && <Step4 form={form} set={set} errors={errors} />}
        {step === 4 && <Step5 form={form} errors={errors} onFile={handleFileChange} />}
        {step === 5 && <Step6 form={form} set={set} errors={errors} onSignature={handleSignature} />}

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={back} disabled={step === 0}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Application"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldError({ msg }) {
  return msg ? <p className="text-xs text-red-500 mt-1">{msg}</p> : null;
}

function Step1({ form, set, errors }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Patient Details</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Title</Label>
          <Select value={form.title} onValueChange={v => set("title", v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {["Mr","Mrs","Ms","Dr","Other"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Gender</Label>
          <Select value={form.gender} onValueChange={v => set("gender", v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {["Male","Female","Other"].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>First Name *</Label>
          <Input value={form.first_name} onChange={e => set("first_name", e.target.value)} />
          <FieldError msg={errors.first_name} />
        </div>
        <div>
          <Label>Surname *</Label>
          <Input value={form.surname} onChange={e => set("surname", e.target.value)} />
          <FieldError msg={errors.surname} />
        </div>
      </div>
      <div>
        <Label>ID Number *</Label>
        <Input value={form.id_number} onChange={e => set("id_number", e.target.value)} />
        <FieldError msg={errors.id_number} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Age</Label>
          <Input type="number" value={form.age} onChange={e => set("age", e.target.value)} />
        </div>
        <div>
          <Label>Weight (kg)</Label>
          <Input type="number" value={form.weight} onChange={e => set("weight", e.target.value)} />
        </div>
        <div>
          <Label>Height (cm)</Label>
          <Input type="number" value={form.height} onChange={e => set("height", e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Occupation</Label>
        <Input value={form.occupation} onChange={e => set("occupation", e.target.value)} />
      </div>
      <div>
        <Label>Email *</Label>
        <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} />
        <FieldError msg={errors.email} />
      </div>
      <div>
        <Label>Phone Number *</Label>
        <Input value={form.phone_number} onChange={e => set("phone_number", e.target.value)} />
        <FieldError msg={errors.phone_number} />
      </div>
      <div>
        <Label>Residential Address</Label>
        <Textarea rows={2} value={form.residential_address} onChange={e => set("residential_address", e.target.value)} />
      </div>
      <div>
        <Label>Work Address</Label>
        <Textarea rows={2} value={form.work_address} onChange={e => set("work_address", e.target.value)} />
      </div>
    </div>
  );
}

function Step2({ form, set, errors }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Medical Information</h2>
      <div>
        <Label>Diagnosis *</Label>
        <p className="text-xs text-muted-foreground mb-1">Provide full description including severity, duration and prognosis</p>
        <Textarea rows={4} value={form.diagnosis} onChange={e => set("diagnosis", e.target.value)} />
        <FieldError msg={errors.diagnosis} />
      </div>
      <div>
        <Label>Current Treatment</Label>
        <p className="text-xs text-muted-foreground mb-1">Include medications, surgeries or therapies</p>
        <Textarea rows={3} value={form.current_treatment} onChange={e => set("current_treatment", e.target.value)} />
      </div>
      <div>
        <Label>Other Conditions (optional)</Label>
        <Textarea rows={2} value={form.other_conditions} onChange={e => set("other_conditions", e.target.value)} />
      </div>
      <div>
        <Label className="mb-2 block">Are you currently smoking cannabis?</Label>
        <div className="flex gap-4">
          {["Yes","No"].map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="smoking" checked={form.smoking_cannabis === v} onChange={() => set("smoking_cannabis", v)} className="accent-primary" />
              <span className="text-sm">{v}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <Label className="mb-2 block">Any other cannabis use?</Label>
        <div className="flex gap-4">
          {["Yes","No"].map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="other_cannabis" checked={form.other_cannabis_use === v} onChange={() => set("other_cannabis_use", v)} className="accent-primary" />
              <span className="text-sm">{v}</span>
            </label>
          ))}
        </div>
      </div>
      {form.other_cannabis_use === "Yes" && (
        <div>
          <Label>Cannabis Use Details</Label>
          <Textarea rows={2} value={form.cannabis_use_details} onChange={e => set("cannabis_use_details", e.target.value)} />
        </div>
      )}
    </div>
  );
}

function ConsentItem({ id, checked, onCheck, label, error }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
        <Checkbox id={id} checked={checked} onCheckedChange={onCheck} className="mt-0.5" />
        <label htmlFor={id} className="text-sm leading-relaxed cursor-pointer">{label}</label>
      </div>
      {error && <p className="text-xs text-red-500 px-1">{error}</p>}
    </div>
  );
}

function Step3({ form, set, errors }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Informed Consent Form</h2>
      <p className="text-sm text-muted-foreground">Please read and confirm each statement below.</p>
      <ConsentItem id="c1" checked={form.consent_acknowledgement} onCheck={v => set("consent_acknowledgement", v)}
        label="I confirm that I have been fully informed about my condition, treatment options, and the use of unregistered medicinal cannabis" error={errors.consent_acknowledgement} />
      <ConsentItem id="c2" checked={form.consent_unregistered} onCheck={v => set("consent_unregistered", v)}
        label="I understand this medication is not registered in South Africa" error={errors.consent_unregistered} />
      <ConsentItem id="c3" checked={form.consent_monitoring} onCheck={v => set("consent_monitoring", v)}
        label="I agree to monitoring and management of any side effects" error={errors.consent_monitoring} />
      <ConsentItem id="c4" checked={form.consent_stop} onCheck={v => set("consent_stop", v)}
        label="I understand I may stop treatment at any time and inform my doctor" error={errors.consent_stop} />
    </div>
  );
}

function Step4({ form, set, errors }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">POPIA Consent</h2>
      <p className="text-sm text-muted-foreground">Protection of Personal Information Act compliance.</p>
      <ConsentItem id="p1" checked={form.popia_consent} onCheck={v => set("popia_consent", v)}
        label="I consent to the collection and processing of my personal and medical information in line with POPIA" error={errors.popia_consent} />
      <ConsentItem id="p2" checked={form.popia_rights} onCheck={v => set("popia_rights", v)}
        label="I understand my rights to access, correct or delete my data" error={errors.popia_rights} />
    </div>
  );
}

function Step5({ form, errors, onFile }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Supporting Documents</h2>
      <div>
        <Label>Upload Clear Copy of ID *</Label>
        <p className="text-xs text-muted-foreground mb-2">Accepted: Images or PDF. Max size: 5MB</p>
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
          <input type="file" accept="image/*,.pdf" onChange={onFile} className="hidden" id="id-upload" />
          <label htmlFor="id-upload" className="cursor-pointer space-y-2 block">
            <div className="text-4xl">📄</div>
            <p className="text-sm font-medium">Click to upload or drag and drop</p>
            <p className="text-xs text-muted-foreground">PNG, JPG, PDF up to 5MB</p>
          </label>
          {form.id_file && <p className="mt-3 text-sm text-primary font-medium">✓ {form.id_file.name}</p>}
        </div>
        <FieldError msg={errors.id_file} />
      </div>
    </div>
  );
}

function Step6({ form, set, errors, onSignature }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Signature</h2>
      <div>
        <Label>Full Name *</Label>
        <Input value={form.full_name_signature} onChange={e => set("full_name_signature", e.target.value)} placeholder="Type your full name" />
        <FieldError msg={errors.full_name_signature} />
      </div>
      <div>
        <Label>Date Signed</Label>
        <Input type="date" value={form.date_signed} onChange={e => set("date_signed", e.target.value)} />
      </div>
      <div>
        <Label className="mb-2 block">Digital Signature *</Label>
        <p className="text-xs text-muted-foreground mb-2">Draw your signature in the box below</p>
        <SignaturePad onChange={onSignature} />
        <FieldError msg={errors.digital_signature} />
      </div>
    </div>
  );
}
