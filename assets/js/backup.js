// Backups (0033): one JSON file with this branch's data, saved to the computer that asks for it.
const TZ = 'Asia/Kolkata';
const istDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d ? new Date(d) : new Date());
const stamp = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`; };

export async function exportBackup(sb, { includeLogs = false, kind = 'manual' } = {}) {
  const { data, error } = await sb.rpc('settings_backup_export', { p_include_logs: includeLogs, p_kind: kind });
  if (error) throw error;
  const name = `pallikkal-pharmacy-backup-${stamp()}${kind === 'auto' ? '-auto' : ''}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return { name, bytes: blob.size, rows: data.rows, tables: data.table_count };
}

// Dashboard (admins): with "Auto Backup (Daily)" on, the first visit of the day downloads a backup;
// otherwise remind when there has been no backup for 7 days. Returns a bell item or null.
export async function runAutoBackup(sb, S) {
  try {
    const { data: info, error } = await sb.rpc('settings_system_info');
    if (error || !info) return null;
    const last = info.last_backup?.at;
    const today = istDay();
    if (S.general.auto_backup) {
      if (last && istDay(last) === today) return null;
      let guard = ''; try { guard = localStorage.getItem('pp.autobackup.day') || ''; } catch { /* ignore */ }
      if (guard === today) return null;
      try { localStorage.setItem('pp.autobackup.day', today); } catch { /* ignore */ }
      const r = await exportBackup(sb, { kind: 'auto' });
      return { tone: 'info', title: 'Daily backup downloaded', detail: `${r.name} · keep it on a pen drive or Google Drive`, href: 'settings.html#backup' };
    }
    if (S.notifications.backup_reminder === false) return null;
    const days = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : null;
    if (days === null || days >= 7) return { tone: 'warn', title: days === null ? 'No backup taken yet' : `Last backup was ${days} days ago`, detail: 'Settings → Backup & Data → Backup Now', href: 'settings.html#backup' };
    return null;
  } catch { return null; }
}
