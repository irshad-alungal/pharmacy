// Billing AI assistant panel.
// The model never does arithmetic or inventory decisions: the Edge Function
// (supabase/functions/billing-assistant) gives it tools that call the validated
// database functions (FEFO preview, line calculation, medicine search). Any
// change it proposes is returned as a suggestion; the cashier clicks Apply and
// billing.js runs it through the same validated path as a manual edit.
import { sb } from './supabase-client.js';
import { esc } from './utils.js';

const ACTION_LABEL = {
  add_medicine: a => `Add ${a.quantity} × ${a.medicine_name || 'medicine'}`,
  set_quantity: a => `Set ${a.medicine_name || 'medicine'} quantity to ${a.quantity}`,
  set_discount: a => `Set ${a.medicine_name || 'medicine'} discount to ${a.discount_pct}%`,
  remove_medicine: a => `Remove ${a.medicine_name || 'medicine'}`
};

export function mountAssistant({ container, getContext, applyAction, onApplied }) {
  if (!container) return;
  container.innerHTML = `
    <div class="section-heading"><div><span class="step-label">AI ASSISTANT</span><h3>Billing assistant</h3></div>
      <span class="muted">Suggestions only — totals and stock always come from the billing engine</span></div>
    <div class="assistant-row">
      <input id="aiInput" maxlength="600" placeholder='e.g. "add 25 dolo 650 and 2 strips of pan 40", "why was batch B used?", "check this bill"' autocomplete="off">
      <button id="aiAsk" class="button-outline" type="button">Ask</button>
      <button id="aiCheck" class="button-ghost" type="button" title="Run deterministic anomaly checks">Check bill</button>
    </div>
    <div id="aiOut" class="assistant-output" aria-live="polite"></div>`;

  const input = container.querySelector('#aiInput');
  const out = container.querySelector('#aiOut');
  let busy = false;
  let history = [];

  const showActions = actions => {
    if (!actions?.length) return '';
    return `<div class="assistant-actions">${actions.map((a, i) =>
      `<button type="button" class="button-outline small" data-ai-apply="${i}">${esc((ACTION_LABEL[a.type] || (() => a.type))(a))}</button>`).join('')}
      ${actions.length > 1 ? '<button type="button" class="button-primary small" data-ai-apply="all">Apply all</button>' : ''}</div>`;
  };

  const render = (reply, actions = [], anomalies = []) => {
    const list = anomalies.length
      ? `<ul class="assistant-anomalies">${anomalies.map(a => `<li class="lvl-${esc(a.level)}">${esc(a.message)}</li>`).join('')}</ul>` : '';
    out.innerHTML = `${reply ? `<div class="assistant-reply">${esc(reply).replace(/\n/g, '<br>')}</div>` : ''}${list}${showActions(actions)}`;
    out.onclick = async e => {
      const b = e.target.closest('[data-ai-apply]');
      if (!b) return;
      const which = b.dataset.aiApply === 'all' ? actions : [actions[+b.dataset.aiApply]];
      b.disabled = true;
      const done = [], failed = [];
      for (const a of which) {
        try { await applyAction(a); done.push((ACTION_LABEL[a.type] || (() => a.type))(a)); }
        catch (err) { failed.push(`${(ACTION_LABEL[a.type] || (() => a.type))(a)}: ${err.message || err}`); }
      }
      if (done.length) onApplied?.(`Applied: ${done.join('; ')}.`);
      if (failed.length) out.insertAdjacentHTML('beforeend', `<div class="row-error">${esc(failed.join(' · '))}</div>`);
    };
  };

  container.querySelector('#aiCheck').onclick = () => {
    const ctx = getContext();
    if (!ctx.groups.length) return render('The bill is empty.');
    render(ctx.anomalies.length ? 'Deterministic checks found the following:' : 'No anomalies found by the billing checks.', [], ctx.anomalies);
  };

  const ask = async () => {
    const message = input.value.trim();
    if (!message || busy) return;
    busy = true;
    out.innerHTML = '<div class="muted">Thinking…</div>';
    try {
      const ctx = getContext();
      const { data, error } = await sb.functions.invoke('billing-assistant', {
        body: { message, context: ctx, history: history.slice(-6) }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      history.push({ role: 'user', content: message }, { role: 'assistant', content: String(data.reply || '') });
      render(data.reply, Array.isArray(data.actions) ? data.actions : [], []);
      input.value = '';
    } catch (err) {
      out.innerHTML = `<div class="row-error">Assistant unavailable: ${esc(err.message || String(err))}. Billing continues to work normally.</div>`;
    } finally {
      busy = false;
    }
  };
  container.querySelector('#aiAsk').onclick = ask;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
}
