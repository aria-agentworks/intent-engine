import { Layout } from "@/components/layout";
import { LeadCard } from "@/components/lead-card";
import { useGetSavedLeads, useUpdateLeadStatus, getGetSavedLeadsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { BookmarkX, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { downloadLeadsCsv } from "@/lib/csv";

export default function SavedLeads() {
  const { data: leadsData, isLoading } = useGetSavedLeads();
  const updateStatus = useUpdateLeadStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStatusChange = (id: string, value: string) => {
    updateStatus.mutate(
      { id, data: { status: value as any } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSavedLeadsQueryKey() });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update status.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'contacted': return "text-blue-400";
      case 'following_up': return "text-amber-400";
      case 'closed': return "text-emerald-400";
      default: return "text-muted-foreground";
    }
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">SAVED_SIGNALS</h1>
            <p className="text-muted-foreground mt-1 text-sm">Bookmarked leads pending outreach or analysis.</p>
          </div>
          {leadsData?.leads && leadsData.leads.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-mono mt-1"
              onClick={() => downloadLeadsCsv(leadsData.leads, `saved_leads_${new Date().toISOString().slice(0,10)}.csv`, true)}
            >
              <Download className="h-3 w-3 mr-1.5" />
              EXPORT_CSV
            </Button>
          )}
        </div>

        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full bg-muted/50 rounded-md border border-border" />
            ))
          ) : leadsData?.leads && leadsData.leads.length > 0 ? (
            leadsData.leads.map(lead => (
              <LeadCard 
                key={lead.id} 
                lead={lead} 
                statusSelector={
                  <Select 
                    value={lead.status || "new"} 
                    onValueChange={(value) => handleStatusChange(lead.id, value)}
                  >
                    <SelectTrigger 
                      className={cn("h-6 text-[10px] font-mono w-[110px] uppercase", getStatusColor(lead.status || "new"))}
                      data-testid="select-lead-status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new" className="text-[10px] font-mono">NEW</SelectItem>
                      <SelectItem value="contacted" className="text-[10px] font-mono text-blue-400">CONTACTED</SelectItem>
                      <SelectItem value="following_up" className="text-[10px] font-mono text-amber-400">FOLLOWING_UP</SelectItem>
                      <SelectItem value="closed" className="text-[10px] font-mono text-emerald-400">CLOSED</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
            ))
          ) : (
            <div className="p-12 border border-dashed border-border rounded-md flex flex-col items-center justify-center text-center bg-card/50">
              <BookmarkX className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-foreground font-medium text-lg">NO_SAVED_SIGNALS</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-md">
                You haven't bookmarked any leads yet. Explore the signal radar and save leads for later follow-up.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
