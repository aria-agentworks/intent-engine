import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Plus, Pencil, Trash2, Star, Phone } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Location {
  id: string;
  locationName: string;
  businessName: string;
  twilioPhoneNumber?: string | null;
  language: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

const DEFAULT_FORM = {
  locationName: "",
  businessName: "",
  twilioPhoneNumber: "",
  language: "en-US",
  isActive: true,
};

const LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-US", label: "Spanish (US)" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "pt-BR", label: "Portuguese (BR)" },
  { code: "it-IT", label: "Italian" },
  { code: "ja-JP", label: "Japanese" },
];

export default function Locations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);

  const { data: locations, isLoading } = useQuery<Location[]>({
    queryKey: ["locations"],
    queryFn: async () => {
      const r = await fetch("/api/voice/locations");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: typeof form) => {
      const r = await fetch("/api/voice/locations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["locations"] }); closeEdit(); toast({ title: "Location created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: typeof form }) => {
      const r = await fetch(`/api/voice/locations/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["locations"] }); closeEdit(); toast({ title: "Location updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/voice/locations/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["locations"] }); setDeleteId(null); toast({ title: "Location removed" }); },
    onError: (e: Error) => { setDeleteId(null); toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/voice/locations/${id}/set-default`, { method: "POST" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });

  function openCreate() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setEditOpen(true);
  }

  function openEdit(loc: Location) {
    setEditingId(loc.id);
    setForm({ locationName: loc.locationName, businessName: loc.businessName, twilioPhoneNumber: loc.twilioPhoneNumber ?? "", language: loc.language, isActive: loc.isActive });
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditingId(null);
  }

  function submit() {
    if (editingId) updateMutation.mutate({ id: editingId, body: form });
    else createMutation.mutate(form);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" />
            Locations
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage multi-location phone numbers and AI configs</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Location
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !locations?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center py-14 gap-3 text-center">
            <MapPin className="h-9 w-9 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">No locations yet</p>
            <p className="text-xs text-muted-foreground/70">Add your first location to enable multi-location support</p>
            <Button size="sm" className="mt-2" onClick={openCreate}>Add Location</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => (
            <Card key={loc.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <MapPin className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{loc.locationName}</p>
                      {loc.isDefault && (
                        <Badge className="text-[10px] gap-1 h-4"><Star className="h-2.5 w-2.5" /> Default</Badge>
                      )}
                      <Badge variant={loc.isActive ? "default" : "secondary"} className="text-[10px] h-4">
                        {loc.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] h-4 uppercase">{loc.language}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{loc.businessName}</p>
                    {loc.twilioPhoneNumber && (
                      <p className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-0.5">
                        <Phone className="h-3 w-3" /> {loc.twilioPhoneNumber}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!loc.isDefault && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDefaultMutation.mutate(loc.id)}>
                        Set Default
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(loc)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!loc.isDefault && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(loc.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit / Create dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => !v && closeEdit()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Location" : "New Location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Location Name</Label>
              <Input placeholder="Downtown Clinic" value={form.locationName} onChange={(e) => setForm((p) => ({ ...p, locationName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input placeholder="Smile Dental" value={form.businessName} onChange={(e) => setForm((p) => ({ ...p, businessName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Twilio Phone Number</Label>
              <Input placeholder="+15551234567" value={form.twilioPhoneNumber} onChange={(e) => setForm((p) => ({ ...p, twilioPhoneNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <select
                value={form.language}
                onChange={(e) => setForm((p) => ({ ...p, language: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))} id="active" />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>Cancel</Button>
            <Button onClick={submit} disabled={!form.locationName || !form.businessName || isPending}>
              {isPending ? "Saving…" : editingId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove location?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. The location and its configuration will be deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
