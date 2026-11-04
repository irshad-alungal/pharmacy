// UI-only convenience. Real enforcement is RLS + SECURITY DEFINER functions in the database.
export const ACCESS = {
  dashboard:['super_admin','admin'], billing:['super_admin','admin','pharmacist','billing'],
  medicines:['super_admin','admin','pharmacist','inventory'], inventory:['super_admin','admin','pharmacist','inventory'],
  purchases:['super_admin','admin','inventory'], distributors:['super_admin','admin','inventory'],
  customers:['super_admin','admin','pharmacist','billing'], sales:['super_admin','admin','pharmacist','billing'],
  returns:['super_admin','admin','pharmacist'], expenses:['super_admin','admin'], finance:['super_admin','admin'],
  reports:['super_admin','admin'], whatsapp:['super_admin','admin'], staff:['super_admin','admin'],
  documents:['super_admin','admin','inventory'], settings:['super_admin','admin'], 'audit-logs':['super_admin','admin']
};
export const can = (role, page) => (ACCESS[page] || []).includes(role);
