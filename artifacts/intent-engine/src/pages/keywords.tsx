import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { 
  useGetKeywords, 
  useCreateKeyword, 
  useUpdateKeyword, 
  useDeleteKeyword, 
  useResetKeywords, 
  getGetKeywordsQueryKey,
  useTestPhrase
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, RotateCcw, Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CreateKeywordBody } from "@workspace/api-zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const formSchema = CreateKeywordBody.extend({
  phrase: z.string().min(2, "Phrase must be at least 2 characters"),
  score: z.coerce.number().min(1, "Min score is 1").max(10, "Max score is 10"),
  category: z.string().min(1, "Category is required"),
});

type FormValues = z.infer<typeof formSchema>;

export default function KeywordsPage() {
  const [scoreFilter, setScoreFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isAdding, setIsAdding] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testPhrase, setTestPhrase] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: keywordsData, isLoading } = useGetKeywords();
  const createKeyword = useCreateKeyword();
  const updateKeyword = useUpdateKeyword();
  const deleteKeyword = useDeleteKeyword();
  const resetKeywords = useResetKeywords();
  const testPhraseMutation = useTestPhrase();

  useEffect(() => {
    if (!testPhrase.trim()) {
      testPhraseMutation.reset();
      return;
    }
    
    const timer = setTimeout(() => {
      testPhraseMutation.mutate({ data: { phrase: testPhrase } });
    }, 600);
    
    return () => clearTimeout(timer);
  }, [testPhrase]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      phrase: "",
      score: 5,
      category: "custom",
    },
  });

  const invalidateKeywords = () => {
    queryClient.invalidateQueries({ queryKey: getGetKeywordsQueryKey() });
  };

  const onSubmit = (values: FormValues) => {
    createKeyword.mutate({ data: values }, {
      onSuccess: () => {
        invalidateKeywords();
        setIsAdding(false);
        form.reset();
        toast({
          title: "Keyword added",
          description: `Successfully added "${values.phrase}"`,
        });
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to add keyword",
          variant: "destructive",
        });
      }
    });
  };

  const handleToggle = (id: string, currentEnabled: boolean) => {
    updateKeyword.mutate(
      { id, data: { enabled: !currentEnabled } },
      {
        onSuccess: () => invalidateKeywords(),
      }
    );
  };

  const handleDelete = (id: string) => {
    if (deletingId === id) {
      deleteKeyword.mutate(
        { id },
        {
          onSuccess: () => {
            invalidateKeywords();
            setDeletingId(null);
          },
        }
      );
    } else {
      setDeletingId(id);
    }
  };

  const handleReset = () => {
    if (confirmReset) {
      resetKeywords.mutate(undefined, {
        onSuccess: () => {
          invalidateKeywords();
          setConfirmReset(false);
          toast({
            title: "Keywords reset",
            description: "Successfully reset to defaults",
          });
        }
      });
    } else {
      setConfirmReset(true);
    }
  };

  const filteredKeywords = keywordsData?.keywords.filter((kw) => {
    // Score filter
    if (scoreFilter === "HIGH" && (kw.score < 8 || kw.score > 10)) return false;
    if (scoreFilter === "MEDIUM" && (kw.score < 5 || kw.score > 7)) return false;
    if (scoreFilter === "LOW" && (kw.score < 1 || kw.score > 4)) return false;
    
    // Category filter
    if (categoryFilter !== "all" && kw.category !== categoryFilter) return false;
    
    return true;
  }) || [];

  const activeCount = keywordsData?.keywords.filter(k => k.enabled).length || 0;

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">KEYWORD_BANK</h1>
            <p className="text-muted-foreground mt-1 text-sm">Configure intent scoring rules</p>
          </div>
          <Badge variant="outline" className="font-mono text-primary border-primary/20 bg-primary/10" data-testid="badge-active-count">
            {activeCount} KEYWORDS ACTIVE
          </Badge>
        </div>

        <div className="flex flex-col sm:flex-row justify-between gap-4 border border-border bg-card p-4 rounded-md">
          <div className="flex flex-1 flex-col sm:flex-row gap-4">
            <div className="flex bg-muted p-1 rounded-md">
              {["ALL", "HIGH", "MEDIUM", "LOW"].map((tab) => (
                <button
                  key={tab}
                  data-testid={`tab-score-${tab.toLowerCase()}`}
                  onClick={() => setScoreFilter(tab)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-mono rounded-sm transition-colors",
                    scoreFilter === tab 
                      ? "bg-background text-foreground shadow-sm" 
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  )}
                >
                  {tab === "HIGH" ? "HIGH (8-10)" : tab === "MEDIUM" ? "MEDIUM (5-7)" : tab === "LOW" ? "LOW (1-4)" : "ALL"}
                </button>
              ))}
            </div>

            <div className="w-full sm:w-48">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="font-mono text-xs h-9" data-testid="select-category-filter">
                  <SelectValue placeholder="CATEGORY" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL_CATEGORIES</SelectItem>
                  <SelectItem value="high">HIGH</SelectItem>
                  <SelectItem value="medium">MEDIUM</SelectItem>
                  <SelectItem value="low">LOW</SelectItem>
                  <SelectItem value="custom">CUSTOM</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={confirmReset ? "destructive" : "outline"}
              size="sm"
              className="font-mono text-xs"
              onClick={handleReset}
              data-testid="button-reset-defaults"
            >
              <RotateCcw className="h-3 w-3 mr-2" />
              {confirmReset ? "CONFIRM_RESET" : "RESET_TO_DEFAULTS"}
            </Button>
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={() => setIsAdding(!isAdding)}
              data-testid="button-add-keyword-toggle"
            >
              {isAdding ? <X className="h-3 w-3 mr-2" /> : <Plus className="h-3 w-3 mr-2" />}
              {isAdding ? "CANCEL" : "ADD_KEYWORD"}
            </Button>
          </div>
        </div>

        <div className="border border-border bg-card p-4 rounded-md">
          <h2 className="text-sm font-bold font-mono mb-3">TEST_PHRASE</h2>
          <Input
            placeholder="Paste any lead text to score it..."
            className="font-mono text-sm"
            data-testid="input-test-phrase"
            value={testPhrase}
            onChange={(e) => setTestPhrase(e.target.value)}
          />
          
          {testPhraseMutation.isPending && (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}
          
          {!testPhraseMutation.isPending && testPhraseMutation.data && testPhrase.trim() !== "" && (
            <div className="mt-4 p-4 bg-muted/30 rounded-md border border-border">
              <div className="flex items-center gap-4 mb-4">
                <div className={cn(
                  "text-3xl font-mono font-bold",
                  testPhraseMutation.data.score >= 8 ? "text-primary" : 
                  testPhraseMutation.data.score >= 5 ? "text-[#f59e0b]" : 
                  "text-muted-foreground"
                )}>
                  {testPhraseMutation.data.score}/10
                </div>
                <Badge 
                  variant="outline"
                  className={cn(
                    "font-mono",
                    testPhraseMutation.data.score >= 8 ? "text-primary border-primary/30 bg-primary/10" : 
                    testPhraseMutation.data.score >= 5 ? "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10" : 
                    "text-muted-foreground border-muted-foreground/30 bg-muted/50"
                  )}
                >
                  {testPhraseMutation.data.intent_label}
                </Badge>
              </div>
              
              <div className="text-sm font-mono mb-2">
                <span className="text-muted-foreground mr-2">MATCHED:</span>
                {testPhraseMutation.data.matched_keyword ? (
                  <span>
                    <span className="bg-muted px-1.5 py-0.5 rounded font-bold">"{testPhraseMutation.data.matched_keyword}"</span>
                    <span className="mx-2">→</span>
                    <Badge variant="outline" className="font-mono text-xs">SCORE: {testPhraseMutation.data.score}</Badge>
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">NO_KEYWORD_MATCHED — default score applied</span>
                )}
              </div>
              
              {testPhraseMutation.data.all_matches && testPhraseMutation.data.all_matches.length > 1 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="text-xs font-mono text-muted-foreground mb-2">ALL MATCHES:</div>
                  <div className="flex flex-wrap gap-2">
                    {testPhraseMutation.data.all_matches.map((match) => (
                      <Badge key={match.id} variant="secondary" className="font-mono text-xs font-normal">
                        "{match.phrase}" <span className="text-muted-foreground ml-1">({match.score})</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border border-border bg-card rounded-md overflow-hidden">
          {isAdding && (
            <div className="p-4 border-b border-border bg-muted/30">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <FormField
                    control={form.control}
                    name="phrase"
                    render={({ field }) => (
                      <FormItem className="flex-1 space-y-0 w-full">
                        <FormControl>
                          <Input 
                            placeholder="Keyword phrase..." 
                            className="font-mono text-sm" 
                            data-testid="input-keyword-phrase"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage className="text-xs mt-1" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="score"
                    render={({ field }) => (
                      <FormItem className="w-24 space-y-0">
                        <FormControl>
                          <Input 
                            type="number" 
                            min={1} 
                            max={10} 
                            placeholder="Score" 
                            className="font-mono text-sm" 
                            data-testid="input-keyword-score"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage className="text-xs mt-1" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem className="w-32 space-y-0">
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="font-mono text-xs" data-testid="select-keyword-category">
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="high">high</SelectItem>
                            <SelectItem value="medium">medium</SelectItem>
                            <SelectItem value="low">low</SelectItem>
                            <SelectItem value="custom">custom</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-xs mt-1" />
                      </FormItem>
                    )}
                  />
                  <div className="flex items-center gap-2">
                    <Button 
                      type="submit" 
                      size="sm" 
                      className="font-mono text-xs" 
                      disabled={createKeyword.isPending}
                      data-testid="button-submit-keyword"
                    >
                      <Check className="h-3 w-3 mr-2" />
                      SAVE
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          )}

          <div className="flex flex-col divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <Skeleton className="h-5 w-48 bg-muted/50" />
                  <div className="flex gap-4">
                    <Skeleton className="h-5 w-16 bg-muted/50" />
                    <Skeleton className="h-5 w-16 bg-muted/50" />
                  </div>
                </div>
              ))
            ) : filteredKeywords.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground font-mono text-sm">
                NO_KEYWORDS_FOUND
              </div>
            ) : (
              filteredKeywords.map((kw) => (
                <div key={kw.id} className={cn("flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 gap-4 transition-colors hover:bg-muted/20", !kw.enabled && "opacity-50 grayscale")}>
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm font-semibold tracking-tight break-all">"{kw.phrase}"</span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "font-mono text-xs",
                        kw.score >= 8 ? "text-primary border-primary/30" : 
                        kw.score >= 5 ? "text-[#f59e0b] border-[#f59e0b]/30" : 
                        "text-muted-foreground border-muted-foreground/30"
                      )}
                    >
                      SCORE: {kw.score}
                    </Badge>
                    
                    <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                      {kw.category.toUpperCase()}
                    </Badge>

                    <Button
                      variant={kw.enabled ? "default" : "secondary"}
                      size="sm"
                      className="h-7 px-3 text-[10px] font-mono"
                      onClick={() => handleToggle(kw.id, kw.enabled)}
                      disabled={updateKeyword.isPending}
                      data-testid={`button-toggle-${kw.id}`}
                    >
                      {kw.enabled ? "ACTIVE" : "DISABLED"}
                    </Button>

                    <Button
                      variant={deletingId === kw.id ? "destructive" : "ghost"}
                      size="sm"
                      className={cn("h-7 px-2", deletingId !== kw.id && "text-muted-foreground hover:text-destructive hover:bg-destructive/10")}
                      onClick={() => handleDelete(kw.id)}
                      disabled={deleteKeyword.isPending}
                      data-testid={`button-delete-${kw.id}`}
                    >
                      {deletingId === kw.id ? (
                        <span className="text-[10px] font-mono px-1">CONFIRM</span>
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
