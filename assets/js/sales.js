import { mountShell } from './navigation.js';
const prof = await mountShell('sales', 'Sales');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the Sales module is not implemented yet. Page shell, navigation and role check are working.</div>';
