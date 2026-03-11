/**
 * OneInchWallet.jsx
 * Full wallet app wired to the 1inch OAuth2 proxy on Railway.
 *
 * Covers:
 *  - OAuth login flow (authorize → callback → token exchange)
 *  - Portfolio view  (ERC-20 balances via 1inch Portfolio API)
 *  - Token swap      (quote + execute via 1inch Swap API)
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Config ──────────────────────────────────────────────────────────────────
const PROXY = "https://1inch-production.up.railway.app";
const DEFAULT_CHAIN = 1; // Ethereum mainnet

// Popular ERC-20 tokens for the swap UI
const TOKEN_LIST = [
  { symbol: "ETH",  address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", decimals: 18, name: "Ether" },
  { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6,  name: "USD Coin" },
  { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6,  name: "Tether" },
  { symbol: "WBTC", address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", decimals: 8,  name: "Wrapped BTC" },
  { symbol: "DAI",  address: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18, name: "Dai" },
  { symbol: "WETH", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", decimals: 18, name: "Wrapped ETH" },
  { symbol: "LINK", address: "0x514910771af9ca656af840dff83e8264ecf986ca", decimals: 18, name: "Chainlink" },
  { symbol: "UNI",  address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", decimals: 18, name: "Uniswap" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const proxyGet = (path, params = {}, sessionId) => {
  const qs = new URLSearchParams({ sessionId, path, ...params }).toString();
  return fetch(`${PROXY}/api/1inch?${qs}`).then(r => r.json());
};

const proxyPost = (path, body, sessionId) =>
  fetch(`${PROXY}/api/1inch?sessionId=${sessionId}&path=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());

const fmt = (n, decimals = 4) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: decimals });

const fmtUSD = n =>
  Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// ─── Styles ───────────────────────────────────────────────────────────────────
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:      #0a0c0f;
    --surface: #111418;
    --border:  #1e2530;
    --teal:    #00e5cc;
    --amber:   #ffb800;
    --red:     #ff4560;
    --text:    #e8edf2;
    --muted:   #5a6478;
    --font-h:  'Syne', sans-serif;
    --font-m:  'JetBrains Mono', monospace;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--font-m); }

  .wallet-root {
    min-height: 100vh;
    background: var(--bg);
    background-image:
      radial-gradient(ellipse 60% 40% at 50% -10%, rgba(0,229,204,0.07) 0%, transparent 60%),
      repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(30,37,48,0.4) 39px, rgba(30,37,48,0.4) 40px),
      repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(30,37,48,0.4) 39px, rgba(30,37,48,0.4) 40px);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 16px 64px;
  }

  .w-header {
    width: 100%; max-width: 900px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 24px 0 20px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 32px;
  }
  .w-logo { display: flex; align-items: center; gap: 10px; }
  .w-logo-mark {
    width: 34px; height: 34px; border-radius: 8px;
    background: linear-gradient(135deg, var(--teal), #006bff);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-h); font-weight: 800; font-size: 14px; color: #000;
  }
  .w-logo-text { font-family: var(--font-h); font-weight: 700; font-size: 17px; letter-spacing: -0.3px; }
  .w-logo-text span { color: var(--teal); }
  .w-badge {
    font-size: 10px; background: rgba(0,229,204,0.1); color: var(--teal);
    border: 1px solid rgba(0,229,204,0.25); border-radius: 4px;
    padding: 2px 7px; letter-spacing: 0.08em; font-weight: 500;
  }
  .w-disconnect {
    background: transparent; border: 1px solid var(--border);
    color: var(--muted); font-family: var(--font-m); font-size: 11px;
    padding: 6px 14px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
  }
  .w-disconnect:hover { border-color: var(--red); color: var(--red); }

  .login-wrap {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; min-height: 70vh; gap: 0; text-align: center;
  }
  .login-glyph {
    width: 80px; height: 80px; border-radius: 20px;
    background: linear-gradient(135deg, var(--teal) 0%, #006bff 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 32px; margin-bottom: 28px;
    box-shadow: 0 0 40px rgba(0,229,204,0.2);
  }
  .login-title {
    font-family: var(--font-h); font-size: 38px; font-weight: 800;
    line-height: 1.1; margin-bottom: 12px; letter-spacing: -1px;
  }
  .login-title span { color: var(--teal); }
  .login-sub {
    color: var(--muted); font-size: 13px; line-height: 1.7;
    max-width: 340px; margin-bottom: 36px;
  }
  .btn-connect {
    background: var(--teal); color: #000; border: none;
    font-family: var(--font-h); font-weight: 700; font-size: 15px;
    padding: 14px 36px; border-radius: 10px; cursor: pointer;
    transition: all 0.2s; letter-spacing: -0.2px;
    box-shadow: 0 0 20px rgba(0,229,204,0.3);
  }
  .btn-connect:hover { background: #00fff5; box-shadow: 0 0 32px rgba(0,229,204,0.5); transform: translateY(-1px); }
  .btn-connect:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .login-note { margin-top: 14px; font-size: 11px; color: var(--muted); }

  .tabs { display: flex; gap: 4px; margin-bottom: 28px; }
  .tab {
    background: transparent; border: 1px solid transparent;
    font-family: var(--font-h); font-size: 14px; font-weight: 600;
    color: var(--muted); padding: 9px 22px; border-radius: 8px;
    cursor: pointer; transition: all 0.15s;
  }
  .tab:hover { color: var(--text); }
  .tab.active {
    background: rgba(0,229,204,0.08); border-color: rgba(0,229,204,0.25);
    color: var(--teal);
  }

  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; padding: 24px;
  }
  .card-title {
    font-family: var(--font-h); font-size: 12px; font-weight: 600;
    color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase;
    margin-bottom: 20px;
  }

  .portfolio-wrap { width: 100%; max-width: 900px; }
  .portfolio-header {
    display: flex; align-items: flex-end; justify-content: space-between;
    margin-bottom: 24px;
  }
  .portfolio-total-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .portfolio-total-value {
    font-family: var(--font-h); font-size: 40px; font-weight: 800;
    letter-spacing: -1.5px; color: var(--text);
  }
  .portfolio-pnl { font-size: 13px; }
  .portfolio-pnl.pos { color: var(--teal); }
  .portfolio-pnl.neg { color: var(--red); }

  .token-table { width: 100%; border-collapse: collapse; }
  .token-table th {
    font-size: 10px; letter-spacing: 0.1em; color: var(--muted);
    text-align: left; padding: 0 12px 12px; font-weight: 400;
    text-transform: uppercase; border-bottom: 1px solid var(--border);
  }
  .token-table th:last-child, .token-table td:last-child { text-align: right; }
  .token-table td { padding: 14px 12px; border-bottom: 1px solid rgba(30,37,48,0.6); font-size: 13px; }
  .token-table tr:last-child td { border-bottom: none; }
  .token-table tr:hover td { background: rgba(255,255,255,0.02); }

  .token-row-name { display: flex; align-items: center; gap: 10px; }
  .token-icon {
    width: 32px; height: 32px; border-radius: 50%;
    background: linear-gradient(135deg, var(--teal), #006bff);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; color: #000; flex-shrink: 0;
  }
  .token-sym { font-weight: 500; color: var(--text); font-size: 14px; }
  .token-name-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
  .change-pos { color: var(--teal); }
  .change-neg { color: var(--red); }

  .swap-wrap { width: 100%; max-width: 480px; }
  .swap-field {
    background: rgba(255,255,255,0.03); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px; margin-bottom: 4px;
  }
  .swap-field-label { font-size: 10px; color: var(--muted); letter-spacing: 0.08em; margin-bottom: 10px; text-transform: uppercase; }
  .swap-row { display: flex; align-items: center; gap: 10px; }
  .swap-input {
    flex: 1; background: transparent; border: none; outline: none;
    font-family: var(--font-m); font-size: 24px; font-weight: 300;
    color: var(--text); min-width: 0;
  }
  .swap-input::placeholder { color: var(--muted); }
  .token-select {
    background: rgba(0,229,204,0.06); border: 1px solid rgba(0,229,204,0.2);
    color: var(--teal); font-family: var(--font-h); font-weight: 700;
    font-size: 13px; padding: 7px 12px; border-radius: 7px; cursor: pointer;
    transition: all 0.15s; white-space: nowrap;
  }
  .token-select:hover { background: rgba(0,229,204,0.12); }

  .swap-divider {
    display: flex; align-items: center; justify-content: center;
    height: 32px; position: relative; z-index: 1; margin: -2px 0;
  }
  .swap-arrow-btn {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--surface); border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.2s; color: var(--muted); font-size: 16px;
  }
  .swap-arrow-btn:hover { border-color: var(--teal); color: var(--teal); transform: rotate(180deg); }

  .swap-quote-box {
    background: rgba(0,229,204,0.04); border: 1px solid rgba(0,229,204,0.12);
    border-radius: 8px; padding: 12px 16px; margin: 12px 0;
    font-size: 12px; color: var(--muted);
  }
  .swap-quote-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .swap-quote-row:last-child { margin-bottom: 0; }
  .swap-quote-val { color: var(--text); font-weight: 500; }

  .btn-swap {
    width: 100%; padding: 16px; border: none; border-radius: 10px;
    background: linear-gradient(135deg, var(--teal), #006bff);
    font-family: var(--font-h); font-weight: 700; font-size: 16px;
    color: #000; cursor: pointer; transition: all 0.2s; margin-top: 12px;
  }
  .btn-swap:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,229,204,0.2); }
  .btn-swap:disabled { opacity: 0.35; cursor: not-allowed; transform: none; box-shadow: none; }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    backdrop-filter: blur(6px); display: flex;
    align-items: center; justify-content: center; z-index: 100;
  }
  .modal {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 24px; width: 340px; max-height: 480px;
    display: flex; flex-direction: column;
  }
  .modal-title { font-family: var(--font-h); font-weight: 700; margin-bottom: 16px; }
  .modal-search {
    background: rgba(255,255,255,0.04); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 14px; width: 100%; outline: none;
    font-family: var(--font-m); color: var(--text); font-size: 13px;
    margin-bottom: 12px;
  }
  .modal-search:focus { border-color: var(--teal); }
  .modal-list { overflow-y: auto; flex: 1; }
  .modal-token-row {
    display: flex; align-items: center; gap: 12px; padding: 10px 8px;
    border-radius: 8px; cursor: pointer; transition: background 0.1s;
  }
  .modal-token-row:hover { background: rgba(255,255,255,0.04); }
  .modal-token-sym { font-weight: 500; font-size: 14px; }
  .modal-token-name { font-size: 11px; color: var(--muted); }

  .address-bar {
    width: 100%; max-width: 900px; margin-bottom: 24px;
    display: flex; gap: 10px;
  }
  .address-input {
    flex: 1; background: var(--surface); border: 1px solid var(--border);
    border-radius: 9px; padding: 10px 16px; font-family: var(--font-m);
    font-size: 12px; color: var(--text); outline: none;
  }
  .address-input:focus { border-color: var(--teal); }
  .address-input::placeholder { color: var(--muted); }
  .btn-load {
    background: rgba(0,229,204,0.1); border: 1px solid rgba(0,229,204,0.3);
    color: var(--teal); font-family: var(--font-h); font-weight: 600;
    font-size: 13px; padding: 10px 20px; border-radius: 9px; cursor: pointer;
    transition: all 0.15s; white-space: nowrap;
  }
  .btn-load:hover { background: rgba(0,229,204,0.18); }

  .spinner {
    width: 20px; height: 20px; border: 2px solid var(--border);
    border-top-color: var(--teal); border-radius: 50%;
    animation: spin 0.7s linear infinite; margin: 0 auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .status-msg {
    font-size: 12px; padding: 10px 16px; border-radius: 8px; margin-top: 10px;
    border: 1px solid;
  }
  .status-msg.ok  { background: rgba(0,229,204,0.06); border-color: rgba(0,229,204,0.2); color: var(--teal); }
  .status-msg.err { background: rgba(255,69,96,0.06);  border-color: rgba(255,69,96,0.2);  color: var(--red); }

  .empty-state { text-align: center; padding: 40px; color: var(--muted); font-size: 13px; }
  .content-area { width: 100%; max-width: 900px; display: flex; flex-direction: column; align-items: center; }
`;

function StyleInjector() {
  useEffect(() => {
    const id = "oneinch-wallet-styles";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id; el.textContent = STYLES;
      document.head.appendChild(el);
    }
  }, []);
  return null;
}

function TokenPicker({ onSelect, onClose, exclude }) {
  const [q, setQ] = useState("");
  const filtered = TOKEN_LIST.filter(
    t => t.symbol !== exclude &&
      (t.symbol.toLowerCase().includes(q.toLowerCase()) ||
       t.name.toLowerCase().includes(q.toLowerCase()))
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Select Token</div>
        <input className="modal-search" placeholder="Search…" value={q}
          onChange={e => setQ(e.target.value)} autoFocus />
        <div className="modal-list">
          {filtered.map(t => (
            <div key={t.symbol} className="modal-token-row" onClick={() => onSelect(t)}>
              <div className="token-icon" style={{ fontSize: "9px" }}>{t.symbol.slice(0,3)}</div>
              <div>
                <div className="modal-token-sym">{t.symbol}</div>
                <div className="modal-token-name">{t.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PortfolioTab({ sessionId }) {
  const [address, setAddress] = useState("0x7eb413211a9de1cd2fe8b8bb6055636c43f7d206");
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    if (!address.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await proxyGet(
        `/portfolio/portfolio/v4/overview/erc20/details`,
        { addresses: address.trim(), use_cache: "true" },
        sessionId
      );
      if (res.error) throw new Error(res.error);
      setData(res);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [address, sessionId]);

  const tokens = data?.result ?? [];
  const totalUSD = tokens.reduce((s, t) => s + (t.value_usd ?? 0), 0);
  const totalPnl  = tokens.reduce((s, t) => s + (t.abs_profit_usd ?? 0), 0);

  return (
    <div className="portfolio-wrap">
      <div className="address-bar">
        <input className="address-input" placeholder="Enter wallet address (0x…) or ENS"
          value={address} onChange={e => setAddress(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load()} />
        <button className="btn-load" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Load Portfolio"}
        </button>
      </div>

      {error && <div className="status-msg err">⚠ {error}</div>}

      {tokens.length > 0 && (
        <div className="portfolio-header">
          <div>
            <div className="portfolio-total-label">Total Portfolio Value</div>
            <div className="portfolio-total-value">{fmtUSD(totalUSD)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="portfolio-total-label">All-time P&L</div>
            <div className={`portfolio-pnl ${totalPnl >= 0 ? "pos" : "neg"}`}
              style={{ fontSize: 22, fontFamily: "var(--font-h)", fontWeight: 700 }}>
              {totalPnl >= 0 ? "+" : ""}{fmtUSD(totalPnl)}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading && <div style={{ padding: "32px 0" }}><div className="spinner" /></div>}
        {!loading && tokens.length === 0 && (
          <div className="empty-state">
            {data ? "No tokens found." : "Enter an address above and click Load Portfolio."}
          </div>
        )}
        {!loading && tokens.length > 0 && (
          <table className="token-table">
            <thead>
              <tr><th>Asset</th><th>Balance</th><th>Price</th><th>Value</th><th>P&L</th><th>24h</th></tr>
            </thead>
            <tbody>
              {tokens.map((t, i) => {
                const change = t.price_to_usd_1d_diff_percent ?? 0;
                return (
                  <tr key={i}>
                    <td>
                      <div className="token-row-name">
                        <div className="token-icon" style={{ fontSize: "9px" }}>
                          {(t.contract_ticker_symbol || "?").slice(0, 3)}
                        </div>
                        <div>
                          <div className="token-sym">{t.contract_ticker_symbol || "—"}</div>
                          <div className="token-name-sub">{t.contract_name || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td>{fmt(t.balance ?? 0, 4)}</td>
                    <td>{t.price_to_usd != null ? fmtUSD(t.price_to_usd) : "—"}</td>
                    <td>{t.value_usd != null ? fmtUSD(t.value_usd) : "—"}</td>
                    <td className={t.abs_profit_usd >= 0 ? "change-pos" : "change-neg"}>
                      {t.abs_profit_usd != null ? `${t.abs_profit_usd >= 0 ? "+" : ""}${fmtUSD(t.abs_profit_usd)}` : "—"}
                    </td>
                    <td className={change >= 0 ? "change-pos" : "change-neg"}>
                      {`${change >= 0 ? "+" : ""}${fmt(change, 2)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)", textAlign: "right" }}>
        Powered by 1inch Portfolio API
      </div>
    </div>
  );
}

function SwapTab({ sessionId }) {
  const [fromToken, setFromToken] = useState(TOKEN_LIST[0]);
  const [toToken,   setToToken]   = useState(TOKEN_LIST[1]);
  const [amount,    setAmount]    = useState("");
  const [quote,     setQuote]     = useState(null);
  const [quoting,   setQuoting]   = useState(false);
  const [swapping,  setSwapping]  = useState(false);
  const [status,    setStatus]    = useState(null);
  const [picker,    setPicker]    = useState(null);
  const [walletAddr, setWalletAddr] = useState("0x7eb413211a9de1cd2fe8b8bb6055636c43f7d206");
  const quoteTimer = useRef(null);

  const rawAmount = amount
    ? BigInt(Math.floor(parseFloat(amount) * 10 ** fromToken.decimals)).toString()
    : null;

  useEffect(() => {
    clearTimeout(quoteTimer.current);
    setQuote(null);
    if (!amount || parseFloat(amount) <= 0) return;
    quoteTimer.current = setTimeout(() => getQuote(), 800);
    return () => clearTimeout(quoteTimer.current);
  }, [amount, fromToken, toToken]);

  const getQuote = async () => {
    if (!rawAmount) return;
    setQuoting(true); setStatus(null);
    try {
      const res = await proxyGet(
        `/swap/v6.0/${DEFAULT_CHAIN}/quote`,
        { src: fromToken.address, dst: toToken.address, amount: rawAmount },
        sessionId
      );
      if (res.error || res.description) throw new Error(res.error || res.description);
      setQuote(res);
    } catch (e) { setStatus({ type: "err", msg: e.message }); }
    finally { setQuoting(false); }
  };

  const executeSwap = async () => {
    if (!rawAmount || !walletAddr) return;
    setSwapping(true); setStatus(null);
    try {
      const res = await proxyGet(
        `/swap/v6.0/${DEFAULT_CHAIN}/swap`,
        { src: fromToken.address, dst: toToken.address, amount: rawAmount, from: walletAddr, slippage: "1" },
        sessionId
      );
      if (res.error || res.description) throw new Error(res.error || res.description);
      setStatus({ type: "ok", msg: `Swap TX ready! Sign & broadcast with your wallet. To: ${res.tx?.to?.slice(0,10)}…` });
    } catch (e) { setStatus({ type: "err", msg: e.message }); }
    finally { setSwapping(false); }
  };

  const flipTokens = () => { setFromToken(toToken); setToToken(fromToken); setQuote(null); };
  const dstAmount = quote?.dstAmount
    ? (Number(quote.dstAmount) / 10 ** toToken.decimals).toFixed(6) : "";

  return (
    <div className="swap-wrap">
      {picker && (
        <TokenPicker
          exclude={picker === "from" ? fromToken.symbol : toToken.symbol}
          onSelect={t => { if (picker === "from") setFromToken(t); else setToToken(t); setPicker(null); setQuote(null); }}
          onClose={() => setPicker(null)}
        />
      )}
      <div className="card">
        <div className="card-title">Swap Tokens · ETH Mainnet</div>
        <div className="swap-field">
          <div className="swap-field-label">You Pay</div>
          <div className="swap-row">
            <input className="swap-input" type="number" placeholder="0.0"
              value={amount} onChange={e => setAmount(e.target.value)} min="0" />
            <button className="token-select" onClick={() => setPicker("from")}>{fromToken.symbol} ▾</button>
          </div>
        </div>
        <div className="swap-divider">
          <button className="swap-arrow-btn" onClick={flipTokens}>⇅</button>
        </div>
        <div className="swap-field">
          <div className="swap-field-label">You Receive</div>
          <div className="swap-row">
            <input className="swap-input" type="number" placeholder={quoting ? "…" : "0.0"}
              value={dstAmount} readOnly />
            <button className="token-select" onClick={() => setPicker("to")}>{toToken.symbol} ▾</button>
          </div>
        </div>
        {quote && !quoting && (
          <div className="swap-quote-box">
            <div className="swap-quote-row">
              <span>Rate</span>
              <span className="swap-quote-val">
                1 {fromToken.symbol} ≈ {fmt(Number(quote.dstAmount) / 10 ** toToken.decimals / parseFloat(amount), 4)} {toToken.symbol}
              </span>
            </div>
            <div className="swap-quote-row">
              <span>Gas estimate</span>
              <span className="swap-quote-val">{fmt(quote.gas ?? 0, 0)} units</span>
            </div>
          </div>
        )}
        {quoting && (
          <div style={{ padding: "12px 0", textAlign: "center" }}>
            <div className="spinner" />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Getting best route…</div>
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Your Wallet Address
          </div>
          <input className="address-input" style={{ width: "100%" }}
            placeholder="0x… (required to build swap TX)"
            value={walletAddr} onChange={e => setWalletAddr(e.target.value)} />
        </div>
        <button className="btn-swap" disabled={!quote || swapping || !walletAddr} onClick={executeSwap}>
          {swapping ? "Building TX…" : quote ? `Swap ${fromToken.symbol} → ${toToken.symbol}` : "Enter an amount"}
        </button>
        {status && <div className={`status-msg ${status.type}`}>{status.msg}</div>}
        <div style={{ marginTop: 14, fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
          Swap TX must be signed & broadcast by your wallet. Slippage: 1%
        </div>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const handleLogin = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${PROXY}/auth/1inch/authorize`).then(r => r.json());
      sessionStorage.setItem("1inch_oauth_state", res.state);
      window.location.href = res.url;
    } catch (e) {
      setError("Could not reach proxy. Is it deployed correctly?");
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-glyph">⚡</div>
      <h1 className="login-title">Your <span>1inch</span><br />Wallet Dashboard</h1>
      <p className="login-sub">
        Connect with 1inch OAuth to view your portfolio across chains and execute token swaps at the best rates.
      </p>
      <button className="btn-connect" onClick={handleLogin} disabled={loading}>
        {loading ? "Redirecting…" : "Connect with 1inch"}
      </button>
      {error && <div className="status-msg err" style={{ marginTop: 16 }}>⚠ {error}</div>}
      <p className="login-note">Your keys stay in your wallet. This app never holds funds.</p>
    </div>
  );
}

function useOAuthCallback(setSessionId) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    const state  = params.get("state");
    if (!code) return;

    const savedState = sessionStorage.getItem("1inch_oauth_state");
    if (savedState && state !== savedState) {
      console.warn("OAuth state mismatch");
      return;
    }

    fetch(`${PROXY}/auth/1inch/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.sessionId) {
          sessionStorage.setItem("1inch_session", data.sessionId);
          setSessionId(data.sessionId);
          window.history.replaceState({}, "", window.location.pathname);
        }
      })
      .catch(console.error);
  }, [setSessionId]);
}

export default function OneInchWallet() {
  const [sessionId, setSessionId] = useState(
    () => sessionStorage.getItem("1inch_session") || null
  );
  const [tab, setTab] = useState("portfolio");

  useOAuthCallback(setSessionId);

  const disconnect = () => {
    sessionStorage.removeItem("1inch_session");
    setSessionId(null);
  };

  return (
    <>
      <StyleInjector />
      <div className="wallet-root">
        <header className="w-header">
          <div className="w-logo">
            <div className="w-logo-mark">1i</div>
            <span className="w-logo-text">Wallet<span>Dashboard</span></span>
            <span className="w-badge">1inch</span>
          </div>
          {sessionId && (
            <button className="w-disconnect" onClick={disconnect}>Disconnect</button>
          )}
        </header>

        {!sessionId ? (
          <LoginScreen />
        ) : (
          <div className="content-area">
            <div className="tabs">
              <button className={`tab ${tab === "portfolio" ? "active" : ""}`} onClick={() => setTab("portfolio")}>Portfolio</button>
              <button className={`tab ${tab === "swap" ? "active" : ""}`} onClick={() => setTab("swap")}>Swap</button>
            </div>
            {tab === "portfolio" && <PortfolioTab sessionId={sessionId} />}
            {tab === "swap"      && <SwapTab      sessionId={sessionId} />}
          </div>
        )}
      </div>
    </>
  );
    }
