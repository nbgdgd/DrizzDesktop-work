// Evaluates one expression in the running pet (or panel) page over CDP.
// Start the pet with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=PORT.
// Usage: node tools/cdp-eval.cjs PORT "expression" [panel]
const [port, expr, which] = process.argv.slice(2);
(async () => {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find((p) => p.type === "page" && (which ? p.url.includes("panel=") : !p.url.includes("panel=")));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id !== 1) return;
    const r = d.result?.result;
    console.log(r?.value !== undefined ? (typeof r.value === "string" ? r.value : JSON.stringify(r.value, null, 1)) : JSON.stringify(d.result?.exceptionDetails?.exception?.description ?? r));
    process.exit();
  };
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
})();
