import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, PhoneCall, PhoneOutgoing, Settings2, Settings,
  Menu, X, Activity, CalendarDays, Plug2, Monitor, ShieldOff,
  ShieldCheck, BarChart3, FileText, MapPin, ChevronDown, ChevronRight,
  LogOut, User,
} from "lucide-react";
import { useState } from "react";
import { useGetVoiceAnalytics } from "@workspace/api-client-react";
import { useClerk, useUser } from "@clerk/react";

const mainNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calls", label: "Call Logs", icon: PhoneCall },
  { href: "/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/outbound", label: "Outbound", icon: PhoneOutgoing },
  { href: "/integrations", label: "Integrations", icon: Plug2 },
  { href: "/configure", label: "Configure", icon: Settings2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

const enterpriseNav = [
  { href: "/supervisor", label: "Live Monitor", icon: Monitor },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/usage", label: "Usage & Cost", icon: BarChart3 },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/dnc", label: "DNC List", icon: ShieldOff },
  { href: "/audit", label: "Audit Logs", icon: ShieldCheck },
];

function MissedBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shrink-0">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function NavLink({
  href, label, icon: Icon, active, badge, onClick,
}: {
  href: string; label: string; icon: React.ElementType;
  active: boolean; badge?: React.ReactNode; onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
      {badge}
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [enterpriseOpen, setEnterpriseOpen] = useState(
    enterpriseNav.some((n) => location.startsWith(n.href)),
  );
  const { data: analytics } = useGetVoiceAnalytics({ days: 7 });
  const missedToday = analytics?.missedToday ?? 0;
  const { signOut } = useClerk();
  const { user } = useUser();

  const close = () => setMobileOpen(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:relative lg:translate-x-0",
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Activity className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-sidebar-foreground leading-none">VoiceAgent</p>
            <p className="text-xs text-muted-foreground mt-0.5">AI Front Desk</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {mainNav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            const showMissed = href === "/calls" && missedToday > 0;
            return (
              <NavLink
                key={href} href={href} label={label} icon={Icon} active={active}
                badge={showMissed ? <MissedBadge count={missedToday} /> : undefined}
                onClick={close}
              />
            );
          })}

          {/* Enterprise section */}
          <div className="pt-2">
            <button
              onClick={() => setEnterpriseOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-sidebar-foreground transition-colors"
            >
              {enterpriseOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Enterprise
            </button>
            {enterpriseOpen && (
              <div className="mt-0.5 space-y-0.5">
                {enterpriseNav.map(({ href, label, icon: Icon }) => (
                  <NavLink
                    key={href} href={href} label={label} icon={Icon}
                    active={location.startsWith(href)} onClick={close}
                  />
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* User footer */}
        <div className="border-t border-sidebar-border px-3 py-3 space-y-1">
          {user && (
            <div className="flex items-center gap-2 px-2 py-1.5">
              {user.imageUrl ? (
                <img src={user.imageUrl} alt="" className="h-6 w-6 rounded-full shrink-0 object-cover" />
              ) : (
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
              <p className="text-xs font-medium text-sidebar-foreground truncate flex-1 min-w-0">
                {user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "User"}
              </p>
            </div>
          )}
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={close} />
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border lg:hidden">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="font-semibold text-sm">VoiceAgent</span>
          {missedToday > 0 && (
            <span className="ml-auto flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {missedToday} missed
            </span>
          )}
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
