import { mountShell } from './navigation.js';
const prof = await mountShell('expenses', 'Expenses');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Expenses module is not implemented yet. Page shell, navigation and role check are working.</div>';
