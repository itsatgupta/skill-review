/* Boot for a normal web server (Vercel): AI calls go to /api/claude, downloads use <a download>. */
const PWKEY = 'skill-review-pw';
let needPw = false;
const getPw = () => { if (!needPw) return ''; let p = ''; try { p = sessionStorage.getItem(PWKEY) || ''; } catch (e) {} if (!p) { p = window.prompt('Team password for AI features') || ''; try { sessionStorage.setItem(PWKEY, p); } catch (e) {} } return p; };
const parseJson = t => { const c = String(t).replace(/```(?:json)?/g, ''); const i = Math.min(...['{', '['].map(ch => { const k = c.indexOf(ch); return k < 0 ? 1e9 : k; })); const j = Math.max(c.lastIndexOf('}'), c.lastIndexOf(']')); return JSON.parse(c.slice(i, j + 1)); };
async function initApi() {
  let h; try { h = await (await fetch('/api/claude')).json(); } catch (e) { return; }
  if (!h || !h.ok) return;
  needPw = !!h.auth;
  const call = async (input, opts = {}) => {
    const r = await fetch('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-password': getPw() }, body: JSON.stringify({ input, modelTier: opts.modelTier || 'default' }), signal: opts.signal });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { try { sessionStorage.removeItem(PWKEY); } catch (e) {} }
    if (!r.ok) throw { code: j.code || 'error', message: j.message || ('Server error ' + r.status) };
    if (opts.onText) opts.onText({ text: j.text, delta: j.text });
    return j;
  };
  call.json = async (input, opts) => parseJson((await call(input, opts)).text);
  sample = call; render();
}
downloads = { save: async ({ filename, data }) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain;charset=utf-8' })); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } };
initApi();
