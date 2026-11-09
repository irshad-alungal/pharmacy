import { esc } from './utils.js';
import { friendly } from './ui.js';

// Phase 7: medicine photo management. The medicine row remains owned by medicines.js.
export function mountMedicinePhotos({ sb, branchId, canManage }) {
  const view = document.getElementById('view');
  const dialog = document.createElement('dialog');
  dialog.id = 'medicinePhotosDialog';
  dialog.innerHTML = `
    <div style="min-width:min(92vw,760px)">
      <h3 id="mpTitle">Medicine photos</h3>
      <div id="mpMsg" role="status"></div>
      <div id="mpGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin:12px 0"></div>
      <div id="mpUploadArea">
        <label>Upload photo (JPG, PNG or WEBP; max 5 MB)
          <input id="mpFile" type="file" accept="image/jpeg,image/png,image/webp">
        </label>
        <button id="mpUpload" type="button">Upload photo</button>
      </div>
      <button id="mpClose" type="button" class="sec">Close</button>
    </div>`;
  view.append(dialog);
  const $ = id => document.getElementById(id);
  let currentMedicine = null;
  $('mpClose').onclick = () => dialog.close();

  async function refresh() {
    $('mpMsg').textContent = 'Loading photos…';
    $('mpGrid').innerHTML = '';
    const { data, error } = await sb.from('medicine_images')
      .select('id,branch_id,medicine_id,path,file_name,is_primary,sort_order')
      .eq('branch_id', branchId).eq('medicine_id', currentMedicine.id)
      .order('sort_order');
    if (error) { $('mpMsg').textContent = friendly(error); return; }
    $('mpMsg').textContent = data.length ? '' : 'No photos uploaded.';
    for (const photo of data) {
      const { data: signed, error: signError } = await sb.storage.from('medicine-images').createSignedUrl(photo.path, 300);
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid #456;border-radius:8px;padding:8px';
      const img = document.createElement('img');
      img.alt = photo.file_name; img.style.cssText = 'width:100%;height:120px;object-fit:contain';
      if (signed?.signedUrl) img.src = signed.signedUrl;
      else img.alt = friendly(signError || 'Preview unavailable');
      const name = document.createElement('small'); name.textContent = photo.file_name;
      const primary = document.createElement('p'); primary.textContent = photo.is_primary ? '★ Primary photo' : '';
      card.append(img, name, primary);
      if (canManage) {
        const make = document.createElement('button'); make.type = 'button'; make.className = 'sec';
        make.textContent = 'Make primary'; make.dataset.primary = photo.id;
        const del = document.createElement('button'); del.type = 'button'; del.className = 'sec';
        del.textContent = 'Delete'; del.dataset.delete = photo.id;
        card.append(make, del);
      }
      $('mpGrid').append(card);
    }
  }

  $('mpGrid').onclick = async e => {
    const b = e.target.closest('button'); if (!b || !currentMedicine) return;
    if (b.dataset.primary) {
      const { error } = await sb.rpc('set_primary_image', { p_image: b.dataset.primary });
      $('mpMsg').textContent = error ? friendly(error) : 'Primary photo updated.';
      if (!error) await refresh();
    }
    if (b.dataset.delete) {
      if (!confirm('Delete this medicine photo?')) return;
      // RPC deletes the metadata row and returns the path. Storage DELETE policy
      // validates the medicine branch using the medicine UUID in the path.
      const { data: path, error } = await sb.rpc('delete_medicine_image', { p_image: b.dataset.delete });
      if (error) { $('mpMsg').textContent = friendly(error); return; }
      const { error: storageError } = await sb.storage.from('medicine-images').remove([path]);
      $('mpMsg').textContent = storageError
        ? `Photo record removed, but file cleanup failed: ${friendly(storageError)}`
        : 'Photo deleted.';
      await refresh();
    }
  };

  $('mpUpload').onclick = async () => {
    const file = $('mpFile').files?.[0];
    if (!file || !currentMedicine) { $('mpMsg').textContent = 'Choose a photo first.'; return; }
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      $('mpMsg').textContent = 'Choose JPG, PNG or WEBP under 5 MB.'; return;
    }
    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const path = `${currentMedicine.id}/${crypto.randomUUID()}.${ext}`;
    $('mpMsg').textContent = 'Uploading…';
    const { error: uploadError } = await sb.storage.from('medicine-images').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { $('mpMsg').textContent = friendly(uploadError); return; }
    const { error: registerError } = await sb.rpc('register_medicine_image', {
      p_medicine: currentMedicine.id, p_path: path, p_name: file.name, p_mime: file.type, p_size: file.size
    });
    if (registerError) {
      await sb.storage.from('medicine-images').remove([path]);
      $('mpMsg').textContent = friendly(registerError); return;
    }
    $('mpFile').value = ''; $('mpMsg').textContent = 'Photo uploaded.'; await refresh();
  };

  view.addEventListener('click', async e => {
    const b = e.target.closest('[data-photos]'); if (!b) return;
    const { data, error } = await sb.from('medicines').select('id,name')
      .eq('id', b.dataset.photos).eq('branch_id', branchId).maybeSingle();
    if (error || !data) { alert(friendly(error || 'Medicine not found')); return; }
    currentMedicine = data; $('mpTitle').textContent = `Photos — ${data.name}`;
    $('mpUploadArea').hidden = !canManage; await refresh(); dialog.showModal();
  });
}
