import { mountShell } from './navigation.js';
const prof = await mountShell('audit-logs', 'Audit logs');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Audit logs module is not implemented yet. Page shell, navigation and role check are working.</div>';
