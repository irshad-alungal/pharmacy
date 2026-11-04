import { mountShell } from './navigation.js';
const prof = await mountShell('reports', 'Reports');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Reports module is not implemented yet. Page shell, navigation and role check are working.</div>';
