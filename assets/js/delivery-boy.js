// delivery-boy.html — the Delivery Boy dashboard for delivery_person accounts.
import { sb } from './supabase-client.js';

const { data: { user }, error } = await sb.auth.getUser();
if (error || !user) {
  location.replace('delivery-boy-login.html');
} else {
  const { data: role } = await sb.rpc('my_role');
  if (role === 'delivery_person') {
    const { mountRiderPage } = await import('./delivery-rider.js');
    await mountRiderPage(user);
  } else {
    // Pharmacy staff opening this address go to Delivery Management.
    location.replace('delivery.html');
  }
}
