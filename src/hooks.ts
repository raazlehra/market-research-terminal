import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.getHealth(),
    refetchInterval: 10000,
  });
}

export function useExpiries(index: string) {
  return useQuery({
    queryKey: ["expiries", index],
    queryFn: () => api.getExpiries(index),
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

export function useOptionChain(index: string, expiry?: string) {
  return useQuery({
    queryKey: ["optionChain", index, expiry],
    queryFn: () => api.getOptionChain(index, expiry),
    refetchInterval: 10000,
    staleTime: 5000,
    refetchIntervalInBackground: false,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: () => api.getOrders(),
    refetchInterval: 3000,
  });
}

export function usePositions() {
  return useQuery({
    queryKey: ["positions"],
    queryFn: () => api.getPositions(),
    refetchInterval: 2000,
  });
}

export function useTradebook() {
  return useQuery({
    queryKey: ["tradebook"],
    queryFn: () => api.getTradebook(),
    refetchInterval: 3000,
  });
}

export function useReports(range: string) {
  return useQuery({
    queryKey: ["reports", range],
    queryFn: () => api.getReports(range),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["tradebook"] });
    },
  });
}

export function useModifyOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.modifyOrder(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["tradebook"] });
    },
  });
}

export function useExitPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { symbol: string; productType?: string }) => api.exitPosition(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tradebook"] });
    },
  });
}

export function useSquareOffAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.squareOffAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tradebook"] });
    },
  });
}
export function usePaperBalance(options?: any) {
  return useQuery({
    queryKey: ["paperBalance"],
    queryFn: () => api.getPaperBalance(),
    refetchInterval: 2000,
    ...options,
  });
}

export function usePaperOrders(options?: any) {
  return useQuery({
    queryKey: ["paperOrders"],
    queryFn: () => api.getPaperOrders(),
    refetchInterval: 2000,
    ...options,
  });
}

export function usePaperTrades(options?: any) {
  return useQuery({
    queryKey: ["paperTrades"],
    queryFn: () => api.getPaperTrades(),
    refetchInterval: 2000,
    ...options,
  });
}

export function usePaperOutcomes(options?: any) {
  return useQuery({
    queryKey: ["paperOutcomes"],
    queryFn: () => api.getPaperOutcomes(),
    refetchInterval: 2000,
    ...options,
  });
}

export function usePaperOutcomeSummary(options?: any) {
  return useQuery({
    queryKey: ["paperOutcomeSummary"],
    queryFn: () => api.getPaperOutcomeSummary(),
    staleTime: 0,
    refetchInterval: 5000,
    ...options,
  });
}

export function usePaperPositions(options?: any) {
  return useQuery({
    queryKey: ["paperPositions"],
    queryFn: () => api.getPaperPositions(),
    refetchInterval: 2000,
    ...options,
  });
}
export function usePaperExit() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, qty }: { orderId: string; qty?: number }) => {
      console.log("📤 Paper Exit: Starting", { orderId, qty });
      try {
        const result = await api.paperExit(orderId, qty);
        console.log("📤 Paper Exit: API response received", result);
        return result;
      } catch (err: any) {
        console.error("❌ Paper Exit: API failed", { orderId, qty, error: err?.message });
        throw err;
      }
    },

    onSuccess: () => {
      console.log("✅ Paper Exit: Invalidating cache");
      qc.invalidateQueries({ queryKey: ["paperPositions"] });
      qc.invalidateQueries({ queryKey: ["paperOrders"] });
      qc.invalidateQueries({ queryKey: ["paperTrades"] });
      qc.invalidateQueries({ queryKey: ["paperBalance"] });
      qc.invalidateQueries({ queryKey: ["paperOutcomes"] });
      qc.invalidateQueries({ queryKey: ["paperOutcomeSummary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      console.log("✅ Paper Exit: Complete");
    },
    
    onError: (err: any) => {
      console.error("❌ Paper Exit: onError handler", { message: err?.message });
    }
  });
}
export function useScanner(
  type: string,
  params: any = {},
  enabled = false
) {
  return useQuery({
    queryKey: ["scanner", type, JSON.stringify(params)],
    queryFn: () => api.scan({ type, params }),
    enabled,
    staleTime: 60000,
  });
}
