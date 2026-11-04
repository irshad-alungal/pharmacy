import { mountShell } from './navigation.js';
const prof = await mountShell('documents', 'Documents');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Documents module is not implemented yet. Page shell, navigation and role check are working.</div>';
