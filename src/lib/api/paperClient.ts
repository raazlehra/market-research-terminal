type ReadError = (res: Response, fallback: string) => Promise<string>;

export async function paperResetRequest(baseUrl: string, headers: HeadersInit, readError: ReadError) {
  const res = await fetch(`${baseUrl}/api/paper/reset`, {
    method: "POST",
    headers,
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to reset paper account."));

  try {
    localStorage.removeItem("fyers_paper_orders");
    localStorage.removeItem("fyers_paper_trades");
    localStorage.removeItem("fyers_paper_positions");
    localStorage.removeItem("fyers_paper_balance");
  } catch {}

  return await res.json();
}
