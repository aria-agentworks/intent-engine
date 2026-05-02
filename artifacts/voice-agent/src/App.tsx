import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { useEffect, useRef, useState } from "react";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import CallDetail from "@/pages/call-detail";
import Outbound from "@/pages/outbound";
import Configure from "@/pages/configure";
import Settings from "@/pages/settings";
import Appointments from "@/pages/appointments";
import Integrations from "@/pages/integrations";
import Supervisor from "@/pages/supervisor";
import DncList from "@/pages/dnc";
import AuditLogs from "@/pages/audit";
import UsageMetrics from "@/pages/usage";
import Reports from "@/pages/reports";
import Locations from "@/pages/locations";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Use the key directly — publishableKeyFromHost causes Clerk to compute
// clerk.{replit-domain} as its FAPI URL in dev, which is unreachable.
// VITE_CLERK_PUBLISHABLE_KEY is the test key in dev, live key in prod.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// proxyUrl is only set in production by Replit's deployment system.
// In dev, Replit routes clerk.{dev-domain} requests internally to Clerk's servers.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

const appearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "#2563eb",
    colorForeground: "#0f172a",
    colorMutedForeground: "#64748b",
    colorDanger: "#dc2626",
    colorBackground: "#ffffff",
    colorInput: "#f8fafc",
    colorInputForeground: "#0f172a",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    formButtonPrimary: "bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors",
    footerActionLink: "text-blue-600 font-medium hover:text-blue-700",
    footerAction: "bg-slate-50 border-t border-slate-100",
  },
};

function MicIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-full w-full" fill="none">
      <path d="M12 14a8 8 0 0 1 16 0v6a8 8 0 0 1-16 0v-6z" fill="white" fillOpacity="0.9" />
      <path d="M10 19a1 1 0 0 1 1 1v1a9 9 0 0 0 18 0v-1a1 1 0 1 1 2 0v1a11 11 0 0 1-10 10.95V33h3a1 1 0 1 1 0 2H16a1 1 0 1 1 0-2h3v-1.05A11 11 0 0 1 9 21v-1a1 1 0 0 1 1-1z" fill="white" />
    </svg>
  );
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 mb-3">
            <MicIcon />
          </div>
          <h2 className="text-xl font-bold text-slate-900">VoiceAgent</h2>
          <p className="text-sm text-slate-500 mt-0.5">Enterprise AI Front Desk</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthLayout>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={appearance} />
    </AuthLayout>
  );
}

function SignUpPage() {
  return (
    <AuthLayout>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} appearance={appearance} />
    </AuthLayout>
  );
}

function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 to-blue-950 flex flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 mb-6">
        <MicIcon />
      </div>
      <h1 className="text-4xl font-bold text-white mb-3">VoiceAgent</h1>
      <p className="text-blue-200 text-lg mb-2">Enterprise AI Front Desk Platform</p>
      <p className="text-slate-400 max-w-md mb-10 text-sm leading-relaxed">
        AI-powered phone answering for medical, dental, and professional practices.
        24/7 scheduling, HIPAA-aware, multi-location, and fully enterprise-ready.
      </p>
      <div className="flex gap-3">
        <a href={`${basePath}/sign-up`} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
          Get Started
        </a>
        <a href={`${basePath}/sign-in`} className="rounded-lg border border-slate-600 px-6 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors">
          Sign In
        </a>
      </div>
    </div>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);
  if (!isLoaded && !timedOut) return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-slate-900 to-blue-950">
      <div className="h-8 w-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
    </div>
  );
  return (isLoaded && isSignedIn) ? <Layout><Dashboard /></Layout> : <LandingPage />;
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">
        <Layout>{children}</Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkQuerySync() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const uid = user?.id ?? null;
      if (prevRef.current !== undefined && prevRef.current !== uid) qc.clear();
      prevRef.current = uid;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function AppRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={appearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQuerySync />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/calls">
              <ProtectedLayout><Calls /></ProtectedLayout>
            </Route>
            <Route path="/calls/:id">
              <ProtectedLayout><CallDetail /></ProtectedLayout>
            </Route>
            <Route path="/appointments">
              <ProtectedLayout><Appointments /></ProtectedLayout>
            </Route>
            <Route path="/outbound">
              <ProtectedLayout><Outbound /></ProtectedLayout>
            </Route>
            <Route path="/integrations">
              <ProtectedLayout><Integrations /></ProtectedLayout>
            </Route>
            <Route path="/configure">
              <ProtectedLayout><Configure /></ProtectedLayout>
            </Route>
            <Route path="/settings">
              <ProtectedLayout><Settings /></ProtectedLayout>
            </Route>
            <Route path="/supervisor">
              <ProtectedLayout><Supervisor /></ProtectedLayout>
            </Route>
            <Route path="/dnc">
              <ProtectedLayout><DncList /></ProtectedLayout>
            </Route>
            <Route path="/audit">
              <ProtectedLayout><AuditLogs /></ProtectedLayout>
            </Route>
            <Route path="/usage">
              <ProtectedLayout><UsageMetrics /></ProtectedLayout>
            </Route>
            <Route path="/reports">
              <ProtectedLayout><Reports /></ProtectedLayout>
            </Route>
            <Route path="/locations">
              <ProtectedLayout><Locations /></ProtectedLayout>
            </Route>
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}
