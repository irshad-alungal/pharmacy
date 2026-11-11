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
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0">
          <button id="mpCameraBtn" type="button" class="sec">Take photo with camera</button>
          <button id="mpChooseBtn" type="button" class="sec">Choose existing photo</button>
        </div>
        <input id="mpCamera" type="file" accept="image/*" capture="environment" hidden>
        <label>Photo file (JPG, PNG or WEBP; max 5 MB)
          <input id="mpFile" type="file" accept="image/jpeg,image/png,image/webp">
        </label>
        <div id="mpCropPreview" style="width:180px;aspect-ratio:1/1;overflow:hidden;border:1px solid #789;border-radius:8px;display:none;margin:10px 0;background:#eee">
          <img id="mpPreview" alt="Square photo preview" style="width:100%;height:100%;object-fit:cover">
        </div>
        <small>Photos are automatically center-cropped to a square (1:1).</small>
        <button id="mpUpload" type="button">Upload square photo</button>
      </div>
      <button id="mpClose" type="button" class="sec">Close</button>
    </div>`;
  view.append(dialog);
  const $ = id => document.getElementById(id);
  let currentMedicine = null;
  let selectedFile = null;
  $('mpClose').onclick = () => dialog.close();
  $('mpCameraBtn').onclick = () => $('mpCamera').click();
  $('mpChooseBtn').onclick = () => $('mpFile').click();
  function selectPhoto(file) {
    selectedFile = file || null;
    $('mpCropPreview').style.display = selectedFile ? 'block' : 'none';
    if (selectedFile) $('mpPreview').src = URL.createObjectURL(selectedFile);
  }
  $('mpCamera').onchange = () => selectPhoto($('mpCamera').files?.[0]);
  $('mpFile').onchange = () => selectPhoto($('mpFile').files?.[0]);

  async function makeSquarePhoto(file) {
    const image = await createImageBitmap(file);
    const side = Math.min(image.width, image.height);
    const sx = Math.floor((image.width - side) / 2);
    const sy = Math.floor((image.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, sx, sy, side, side, 0, 0, 1200, 1200);
    image.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Could not prepare the square photo. Please try another image.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'medicine-photo'}.jpg`, { type: 'image/jpeg' });
  }

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
    const original = selectedFile;
    if (!original || !currentMedicine) { $('mpMsg').textContent = 'Take a photo or choose an image first.'; return; }
    if (!['image/jpeg','image/png','image/webp'].includes(original.type) || original.size > 5 * 1024 * 1024) {
      $('mpMsg').textContent = 'Choose JPG, PNG or WEBP under 5 MB.'; return;
    }
    let file;
    try { file = await makeSquarePhoto(original); }
    catch (err) { $('mpMsg').textContent = friendly(err); return; }
    const path = `${currentMedicine.id}/${crypto.randomUUID()}.jpg`;
    $('mpMsg').textContent = 'Uploading square photo…';
    const { error: uploadError } = await sb.storage.from('medicine-images').upload(path, file, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) { $('mpMsg').textContent = friendly(uploadError); return; }
    const { error: registerError } = await sb.rpc('register_medicine_image', {
      p_medicine: currentMedicine.id, p_path: path, p_name: original.name, p_mime: 'image/jpeg', p_size: file.size
    });
    if (registerError) {
      await sb.storage.from('medicine-images').remove([path]);
      $('mpMsg').textContent = friendly(registerError); return;
    }
    $('mpFile').value = ''; $('mpCamera').value = ''; selectedFile = null; $('mpCropPreview').style.display = 'none'; $('mpMsg').textContent = 'Square photo uploaded.'; await refresh();
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
