import { mountShell } from './navigation.js';
const prof = await mountShell('finance', 'Finance');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Finance module is not implemented yet. Page shell, navigation and role check are working.</div>';
