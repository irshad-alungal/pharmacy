import { mountShell } from './navigation.js';
const prof = await mountShell('dashboard', 'Dashboard');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Dashboard module is not implemented yet. Page shell, navigation and role check are working.</div>';
