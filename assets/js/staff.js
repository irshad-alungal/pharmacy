import { mountShell } from './navigation.js';
const prof = await mountShell('staff', 'Staff');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Staff module is not implemented yet. Page shell, navigation and role check are working.</div>';
