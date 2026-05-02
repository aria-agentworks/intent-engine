import { useState, useEffect } from "react";
import { useGetVoiceConfig, useUpdateVoiceConfig } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Copy, Check, AlertTriangle, ExternalLink, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

type HourEntry = { open: string; close: string; closed: boolean };

function isCurrentlyOpen(hoursJson: string | null | undefined): boolean {
  if (!hoursJson) return false;
  try {
    const hours: Record<string, HourEntry> = JSON.parse(hoursJson);
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "";
    const h = parts.find((p) => p.type === "hour")?.value ?? "0";
    const m = parts.find((p) => p.type === "minute")?.value ?? "0";
    const current = parseInt(h) * 60 + parseInt(m);
    const entry = hours[weekday];
    if (!entry || entry.closed) return false;
    const [openH, openM] = entry.open.split(":").map(Number);
    const [closeH, closeM] = entry.close.split(":").map(Number);
    return current >= openH * 60 + openM && current < closeH * 60 + closeM;
  } catch {
    return false;
  }
}

function getCurrentDayHours(hoursJson: string | null | undefined): string {
  if (!hoursJson) return "";
  try {
    const hours: Record<string, HourEntry> = JSON.parse(hoursJson);
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
    });
    const weekday = fmt.format(now).toLowerCase();
    const entry = hours[weekday];
    if (!entry || entry.closed) return "Closed today";
    return `${entry.open} – ${entry.close} ET`;
  } catch {
    return "";
  }
}

export default function Settings() {
  const { data: config, isLoading } = useGetVoiceConfig();
  const mutation = useUpdateVoiceConfig();

  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (config) {
      setAccountSid(config.twilioAccountSid ?? "");
      setAuthToken("");
      setPhoneNumber(config.twilioPhoneNumber ?? "");
      setIsActive(config.isActive ?? false);
    }
  }, [config]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setSaveError("");
    const payload: Record<string, unknown> = {
      twilioPhoneNumber: phoneNumber || undefined,
      twilioAccountSid: accountSid || undefined,
      isActive,
    };
    if (authToken) payload.twilioAuthToken = authToken;

    mutation.mutate({ data: payload as Parameters<typeof mutation.mutate>[0]["data"] }, {
      onSuccess: () => {
        setSaved(true);
        setAuthToken("");
      },
      onError: () => setSaveError("Failed to save settings."),
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const webhookUrl = config?.webhookUrl ?? "";
  const isMissingCredentials = !config?.twilioAccountSid || !config?.twilioPhoneNumber;
  const open = isCurrentlyOpen(config?.hoursJson);
  const todayHours = getCurrentDayHours(config?.hoursJson);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Twilio credentials and webhook configuration</p>
      </div>

      {saved && (
        <Alert className="border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-emerald-800">Settings saved successfully.</AlertDescription>
        </Alert>
      )}
      {saveError && (
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">{saveError}</AlertDescription>
        </Alert>
      )}

      {/* Webhook URLs */}
      <Card className="border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Twilio Webhook URLs</CardTitle>
          <p className="text-xs text-muted-foreground">
            Configure your Twilio phone number to call these URLs when a call arrives
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {isMissingCredentials && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                Add your Twilio credentials below, then set a webhook URL in your Twilio console.
              </AlertDescription>
            </Alert>
          )}

          {/* Real-time stream (recommended) */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Real-time AI (Recommended)</Label>
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">WebSocket</span>
            </div>
            <p className="text-xs text-muted-foreground">Whisper STT + GPT + OpenAI TTS — sub-second response, natural conversation</p>
            <div className="relative">
              <code className="flex items-center gap-2 rounded-lg bg-muted border border-border px-3 py-2.5 pr-10 text-xs font-mono text-foreground break-all">
                {(config as Record<string, string> | undefined)?.streamWebhookUrl || (webhookUrl ? webhookUrl.replace("/inbound", "/stream-inbound") : "Save credentials first")}
              </code>
              {webhookUrl && <CopyButton text={(config as Record<string, string> | undefined)?.streamWebhookUrl ?? webhookUrl.replace("/inbound", "/stream-inbound")} />}
            </div>
          </div>

          {/* Status callback */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Call Status Callback</Label>
            <div className="relative">
              <code className="flex items-center gap-2 rounded-lg bg-muted border border-border px-3 py-2.5 pr-10 text-xs font-mono text-foreground break-all">
                {(config as Record<string, string> | undefined)?.statusCallbackUrl || (webhookUrl ? webhookUrl.replace("/inbound", "/status") : "Save credentials first")}
              </code>
              {webhookUrl && <CopyButton text={(config as Record<string, string> | undefined)?.statusCallbackUrl ?? webhookUrl.replace("/inbound", "/status")} />}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <ExternalLink className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1 flex-1">
              <p className="font-medium text-foreground">Twilio Console Setup</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Go to <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Twilio Console → Phone Numbers → Active Numbers</a></li>
                <li>Click your number (<span className="font-mono">{config?.twilioPhoneNumber || "your number"}</span>)</li>
                <li>Under <strong>Voice Configuration</strong> → "A call comes in" → <strong>Webhook, HTTP POST</strong></li>
                <li>Paste the <strong>Real-time AI</strong> URL above</li>
                <li>Set <strong>Call Status Changes</strong> → paste the Status Callback URL</li>
                <li>Click <strong>Save Configuration</strong></li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Twilio credentials */}
      <Card className="border-card-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold">Twilio Credentials</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sid">Account SID</Label>
              <Input
                id="sid"
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="token">Auth Token</Label>
              <Input
                id="token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={config?.twilioAuthToken ? "••••••••" : "Enter auth token..."}
                className="font-mono text-sm"
              />
              {config?.twilioAuthToken && !authToken && (
                <p className="text-xs text-muted-foreground">Leave blank to keep existing token</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Twilio Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+15550001234"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Include country code, e.g. +12602335208</p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3.5">
              <div>
                <p className="text-sm font-medium">Voice Agent Active</p>
                <p className="text-xs text-muted-foreground">Enable to start answering calls</p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Status */}
      <Card className="border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5 text-sm">
            {[
              {
                label: "Twilio Account SID",
                ok: !!config?.twilioAccountSid,
                detail: config?.twilioAccountSid
                  ? config.twilioAccountSid.slice(0, 8) + "..."
                  : undefined,
              },
              {
                label: "Twilio Auth Token",
                ok: !!config?.twilioAuthToken,
              },
              {
                label: "Twilio Phone Number",
                ok: !!config?.twilioPhoneNumber,
                detail: config?.twilioPhoneNumber ?? undefined,
              },
              {
                label: "Voice Agent",
                ok: config?.isActive,
              },
            ].map(({ label, ok, detail }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-muted-foreground">{label}</span>
                <div className="flex items-center gap-2">
                  {detail && <span className="text-xs font-mono text-muted-foreground">{detail}</span>}
                  <span className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-medium",
                    ok ? "text-emerald-600" : "text-amber-600"
                  )}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-amber-400")} />
                    {ok ? "Configured" : "Not set"}
                  </span>
                </div>
              </div>
            ))}

            <div className="border-t border-border pt-2.5 mt-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  <span>Answering calls right now</span>
                </div>
                <div className="flex items-center gap-2">
                  {todayHours && (
                    <span className="text-xs text-muted-foreground">{todayHours}</span>
                  )}
                  <span className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-medium",
                    open ? "text-emerald-600" : "text-slate-500"
                  )}>
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      open ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                    )} />
                    {open ? "Open" : "Outside hours"}
                  </span>
                </div>
              </div>
              {!open && config?.hoursJson && (
                <p className="text-xs text-muted-foreground mt-1.5 pl-5">
                  Callers will hear an after-hours message. Update business hours in{" "}
                  <a href="/voice-agent/configure" className="text-primary underline underline-offset-2">Configure</a>.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
