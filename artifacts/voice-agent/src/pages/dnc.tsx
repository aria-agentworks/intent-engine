import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ShieldOff, Plus, Trash2, Search, Upload } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface DncEntry {
  id: string;
  phoneNumber: string;
  reason: string;
  addedBy?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

interface DncResponse {
  entries: DncEntry[];
  total: number;
}

export default function DncList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ phoneNumber: "", reason: "", expiresAt: "" });
  const [bulkText, setBulkText] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data, isLoading } = useQuery<DncResponse>({
    queryKey: ["dnc", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const r = await fetch(`/api/voice/dnc?${params}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (body: typeof form) => {
      const r = await fetch("/api/voice/dnc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dnc"] });
      setAddOpen(false);
      setForm({ phoneNumber: "", reason: "", expiresAt: "" });
      toast({ title: "Number added to DNC list" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/voice/dnc/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dnc"] });
      toast({ title: "Number removed from DNC list" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async (numbers: string[]) => {
      const r = await fetch("/api/voice/dnc/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["dnc"] });
      setBulkOpen(false);
      setBulkText("");
      toast({ title: `Imported ${d.imported} numbers` });
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  function formatDate(s: string) {
    return new Date(s).toLocaleDateString();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldOff className="h-6 w-6 text-primary" />
            Do Not Call List
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage numbers blocked from outbound calls</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1.5" /> Bulk Import
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Number
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by number or reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {data ? `${data.total} entries` : "DNC Entries"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !data?.entries.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldOff className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No DNC entries yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Add numbers to prevent outbound calls</p>
            </div>
          ) : (
            <div className="divide-y">
              {data.entries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-medium">{entry.phoneNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{entry.reason || "No reason"}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {entry.expiresAt ? (
                      <Badge variant="outline" className="text-xs">
                        Expires {formatDate(entry.expiresAt)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Permanent</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(entry.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to DNC List</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input
                placeholder="+15551234567"
                value={form.phoneNumber}
                onChange={(e) => setForm((p) => ({ ...p, phoneNumber: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                placeholder="Opted out, do not contact"
                value={form.reason}
                onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Expires <span className="text-muted-foreground">(optional, blank = permanent)</span></Label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate(form)} disabled={!form.phoneNumber || addMutation.isPending}>
              {addMutation.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk import dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bulk Import</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Paste phone numbers, one per line.</p>
            <textarea
              className="w-full h-40 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={"+15551234567\n+15559876543\n…"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkMutation.mutate(bulkText.split("\n").map((n) => n.trim()).filter(Boolean))}
              disabled={!bulkText.trim() || bulkMutation.isPending}
            >
              {bulkMutation.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
