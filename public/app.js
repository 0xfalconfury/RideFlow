const $ = s => document.querySelector(s);
const modal = $('#authModal'), loginForm = $('#loginForm'), registerForm = $('#registerForm');
let currentUser = null, socket = null, activeRide = null, driverWatchId = null;

function showModal(tab = 'login') { modal.classList.remove('hidden'); switchTab(tab) }
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  loginForm.classList.toggle('hidden', tab !== 'login'); registerForm.classList.toggle('hidden', tab !== 'register'); $('#authMessage').textContent = '';
}
$('#openLogin').onclick = () => showModal('login'); $('#heroLogin').onclick = () => showModal('login'); $('#heroRegister').onclick = () => showModal('register');
$('#closeModal').onclick = () => modal.classList.add('hidden');
document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
$('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
$('#regRole').onchange = e => $('#driverFields').classList.toggle('hidden', e.target.value !== 'driver');

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function message(text) { $('#authMessage').textContent = text }
loginForm.onsubmit = async e => {
  e.preventDefault(); const data = Object.fromEntries(new FormData(loginForm));
  try { const result = await api('/api/login', { method: 'POST', body: JSON.stringify(data) }); currentUser = result.user; modal.classList.add('hidden'); await renderDashboard() }
  catch (err) { message(err.message) }
};
registerForm.onsubmit = async e => {
  e.preventDefault(); const form = new FormData(registerForm);
  try { const result = await api('/api/register', { method: 'POST', body: form }); message(result.message); registerForm.reset(); $('#driverFields').classList.add('hidden') }
  catch (err) { message(err.message) }
};
$('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload() };

async function boot() {
  try { const r = await api('/api/me'); currentUser = r.user; await renderDashboard() } catch { }
}
function stat(label, value) { return `<div class="stat"><small>${label}</small><strong>${value ?? 0}</strong></div>` }
function panel(title, body) { return `<section class="panel"><h3>${title}</h3>${body}</section>` }
function table(headers, rows) { return `<div style="overflow:auto"><table class="data-table"><thead><tr>${headers.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="8">No records found.</td></tr>'}</tbody></table></div>` }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function setNav(items, active) { $('#sideNav').innerHTML = items.map(i => `<button class="${i === active ? 'active' : ''}" data-view="${i}">${i}</button>`).join(''); $('#sideNav').querySelectorAll('button').forEach(b => b.onclick = () => loadView(b.dataset.view)) }
async function renderDashboard() {
  document.querySelector('main').classList.add('hidden'); document.querySelector('footer').classList.add('hidden'); document.querySelector('.topbar').classList.add('hidden');
  $('#dashboard').classList.remove('hidden'); $('#sideUser').innerHTML = `<b>${esc(currentUser.name)}</b>${esc(currentUser.mobile)}`; $('#rolePill').textContent = currentUser.role;
  const items = currentUser.role === 'admin' ? ['Overview', 'Accounts', 'Rides', 'Transactions', 'Settings']
    : currentUser.role === 'driver' ? ['Overview', 'Requests', 'My rides', 'Wallet', 'Profile']
      : ['Overview', 'Book a ride', 'My rides', 'Wallet', 'Profile'];
  setNav(items, 'Overview'); await loadView('Overview');
  socket = io(); socket.on('ride:request', () => { if (currentUser.role === 'driver') loadView('Requests') });
  socket.on('ride:offer', r => alert(`Driver offered ৳${r.offered_fare}. Open My rides to confirm.`));
  socket.on('ride:status', () => loadView('My rides'));
}
async function loadView(view) {
  $('#dashTitle').textContent = view;
  try {
    if (currentUser.role === 'admin' && view === 'Transactions') return adminTransactions();
    if (currentUser.role === 'admin' && view === 'Settings') return adminSettings();
    if (currentUser.role !== 'admin' && view === 'Wallet') return walletPage();
    if (currentUser.role === 'admin' && view === 'Overview') return adminOverview();
    if (currentUser.role === 'admin' && view === 'Accounts') return adminAccounts();
    if (currentUser.role === 'admin' && view === 'Rides') return adminRides();
    if (currentUser.role === 'driver' && view === 'Overview') return driverOverview();
    if (currentUser.role === 'driver' && view === 'Requests') return driverRequests();
    if (currentUser.role === 'driver' && view === 'My rides') return myRides();
    if (currentUser.role !== 'admin' && view === 'Profile') return profilePage();
    if (currentUser.role === 'customer' && view === 'Overview') return customerOverview();
    if (currentUser.role === 'customer' && view === 'Book a ride') return booking();
    if (currentUser.role === 'customer' && view === 'My rides') return myRides();
  } catch (e) { $('#dashContent').innerHTML = panel('Something went wrong', `<p class="empty">${esc(e.message)}</p>`) }
}
async function adminOverview() {
  const s = await api('/api/admin/stats');
  $('#dashContent').innerHTML = `<div class="stat-grid">${stat('Total bookings', s.total_bookings)}${stat('Completed rides', s.completed_rides)}${stat('Active customers', s.active_users)}${stat('Approved drivers', s.active_drivers)}${stat('Gross ride value', `৳${s.gross_ride_value}`)}${stat('Cancellations', s.cancellations)}</div>${panel('Platform overview', '<p class="empty">Use Accounts to approve registrations and manage customer/driver accounts. Use Rides to review trip history.</p>')}`;
}
async function adminAccounts() {
  const data = await api('/api/admin/users');
  const rows = data.users.filter(u => u.role !== 'admin').map(u => `<tr><td>${esc(u.name)}<br><small>${esc(u.role)}</small></td><td>${esc(u.mobile)}</td><td>${esc(u.status)}</td><td>${esc(u.nid_number || '—')}</td><td><button class="action" onclick="viewAccount('${u.id}')">View details / Edit</button><button class="action" onclick="changeStatus('${u.id}','approved')">Approve</button><button class="action" onclick="changeStatus('${u.id}','rejected')">Reject</button><button class="action" onclick="changeStatus('${u.id}','blocked')">Block</button><button class="action danger" onclick="deleteUser('${u.id}')">Delete</button></td></tr>`).join('');
  $('#dashContent').innerHTML = panel('Customer & driver accounts', `<p class="empty">Select View details / Edit to inspect the full profile, vehicle information and submitted documents.</p>${table(['Name / role', 'Mobile', 'Status', 'NID number', 'Actions'], rows)}<div id="accountDetails"></div>`);
}
window.viewAccount = async id => {
  try {
    const { user: u } = await api(`/api/admin/users/${id}/details`);
    const field = (label, name, value = '', type = 'text') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
    const image = (url, label) => url ? `<div class="document-preview"><b>${label}</b><a href="${url}" target="_blank" rel="noopener">Open original document</a><img src="${url}" alt="${label}" loading="lazy"></div>` : `<p class="hint">${label}: Not uploaded</p>`;
    const vehicle = u.role === 'driver' ? `<h4>Vehicle information</h4><div class="form-grid">${field('Registration number', 'registration_number', u.registration_number)}${field('Make / model', 'make_model', u.make_model)}${field('Vehicle type', 'vehicle_type', u.vehicle_type)}${field('Color', 'color', u.color)}<label>Vehicle details<textarea name="vehicle_details">${esc(u.vehicle_details || '')}</textarea></label><label>Vehicle approval status<select name="vehicle_status"><option ${u.vehicle_status === 'pending' ? 'selected' : ''}>pending</option><option ${u.vehicle_status === 'approved' ? 'selected' : ''}>approved</option><option ${u.vehicle_status === 'rejected' ? 'selected' : ''}>rejected</option></select></label></div>${image(u.vehicle_photo_url, 'Vehicle photo')}` : '';
    $('#accountDetails').innerHTML = panel(`Account details — ${esc(u.name)}`, `<form id="editAccountForm" data-id="${u.id}"><div class="detail-meta"><span>Role: <b>${esc(u.role)}</b></span><span>Registered: <b>${new Date(u.created_at).toLocaleString()}</b></span><span>Last updated: <b>${new Date(u.updated_at).toLocaleString()}</b></span></div><div class="form-grid">${field('Full name', 'name', u.name)}${field('Mobile number', 'mobile', u.mobile)}${field('Email', 'email', u.email)}${field('NID number', 'nid_number', u.nid_number)}${field('Present address', 'present_address', u.present_address)}${field('Permanent address', 'permanent_address', u.permanent_address)}<label>Account status<select name="status">${['pending', 'approved', 'rejected', 'blocked'].map(x => `<option value="${x}" ${u.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div><h4>Submitted identity document</h4>${image(u.nid_url, 'NID image')}${vehicle}<div class="detail-actions"><button class="btn" type="submit">Save changes</button><button class="action" type="button" onclick="adminAccounts()">Close details</button></div><p id="editAccountMessage" class="message"></p></form>`);
    $('#editAccountForm').onsubmit = async e => {
      e.preventDefault(); const payload = Object.fromEntries(new FormData(e.target));
      try { await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }); $('#editAccountMessage').textContent = 'Account information updated successfully.'; await adminAccounts(); await viewAccount(id) } catch (err) { $('#editAccountMessage').textContent = err.message }
    };
  } catch (e) { alert(e.message) }
};
window.changeStatus = async (id, status) => { try { await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ status }) }); await adminAccounts() } catch (e) { alert(e.message) } };
window.deleteUser = async id => { if (!confirm('Permanently delete this account?')) return; try { await api('/api/admin/users/' + id, { method: 'DELETE' }); await adminAccounts() } catch (e) { alert(e.message) } };
async function adminRides() {
  const d = await api('/api/admin/rides');
  const rows = d.rides.map(r => `<tr><td>${esc(r.id.slice(0, 8))}</td><td>${esc(r.customer_name)}</td><td>${esc(r.driver_name || '—')}</td><td>${esc(r.pickup)} → ${esc(r.destination)}</td><td>${esc(r.status)}</td><td>${r.final_fare ? `৳${r.final_fare}` : '—'}</td><td><button class="action" onclick="viewChat('${r.id}')">Chat log</button></td></tr>`).join('');
  $('#dashContent').innerHTML = panel('Ride history', table(['Ride', 'Customer', 'Driver', 'Route', 'Status', 'Fare', 'Chat'], rows)) +
    `<div id="chatLog"></div>`;
}
window.viewChat = async id => { try { const d = await api('/api/admin/messages/' + id); $('#chatLog').innerHTML = panel('Chat log', d.messages.map(m => `<p class="empty"><b>${esc(m.sender_name)}:</b> ${esc(m.message)} <small>${new Date(m.created_at).toLocaleString()}</small></p>`).join('') || '<p class="empty">No messages.</p>') } catch (e) { alert(e.message) } };
async function driverOverview() {
  const [d, profile] = await Promise.all([api('/api/rides/mine'), api('/api/profile')]);
  const rides = d.rides, completed = rides.filter(r => r.status === 'completed'), cancelled = rides.filter(r => r.status === 'cancelled');
  const earned = completed.reduce((n, r) => n + Number(r.final_fare || 0), 0);
  $('#dashContent').innerHTML = `<div class="stat-grid">${stat('Total rides', rides.length)}${stat('Completed', completed.length)}${stat('Cancellations', cancelled.length)}${stat('Earnings', `৳${earned.toFixed(2)}`)}</div>
  ${panel('Driver availability', `<p class="hint">Go online to share your current location with nearby customers. Your location is used only while online.</p><p><span class="status-dot ${profile.profile.is_online ? 'online' : ''}"></span><b id="onlineLabel">${profile.profile.is_online ? 'You are online' : 'You are offline'}</b></p><button class="btn" id="availabilityBtn">${profile.profile.is_online ? 'Go offline' : 'Go online'}</button>`)}
  ${panel('My current location', `<p class="hint">Click the map or press the button below to set your live position used in customer searches.</p>
     <div class="action-row"><button class="action" id="locateMeBtn">⌖ Use my current location</button><input id="locSearch" class="loc-input" placeholder="Search an address…" autocomplete="off"><div id="locSuggestions" class="suggestions"></div></div>
     <div id="driverLocMap" class="ride-map"></div>
     <p id="driverLocStatus" class="message"></p>`)}
  ${panel('Driver tip', '<p class="empty">Keep your vehicle and profile information up to date. Ride requests appear in the Requests tab.</p>')}`;

  // Driver mini map
  const startLat = Number(profile.profile.current_lat) || 23.8103;
  const startLng = Number(profile.profile.current_lng) || 90.4125;
  const dmap = L.map('driverLocMap').setView([startLat, startLng], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(dmap);
  let dmark = L.marker([startLat, startLng], { draggable: true }).addTo(dmap).bindPopup('Your location').openPopup();

  const save = async (lat, lng) => {
    try {
      await api('/api/driver/location', { method: 'POST', body: JSON.stringify({ lat, lng }) });
      const { display_name } = await api(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
      $('#driverLocStatus').textContent = 'Location saved: ' + display_name;
    } catch (err) { $('#driverLocStatus').textContent = err.message }
  };
  const place = (lat, lng, label) => { dmark.setLatLng([lat, lng]); dmap.setView([lat, lng], 15); if (label) dmark.bindPopup(label).openPopup(); save(lat, lng); };
  dmark.on('dragend', () => { const ll = dmark.getLatLng(); place(ll.lat, ll.lng, 'Dragged location') });
  dmap.on('click', e => place(e.latlng.lat, e.latlng.lng, 'Selected location'));
  $('#locateMeBtn').onclick = () => {
    if (!navigator.geolocation) return alert('Location not supported.');
    navigator.geolocation.getCurrentPosition(p => place(p.coords.latitude, p.coords.longitude, 'My current location'), () => alert('Location permission denied.'), { enableHighAccuracy: true, timeout: 12000 });
  };
  // Autocomplete on driver-location search box
  attachAutocomplete($('#locSearch'), $('#locSuggestions'), item => { place(item.lat, item.lon, item.display_name); $('#locSearch').value = item.display_name; });

  $('#availabilityBtn').onclick = () => { if (profile.profile.is_online) { if (driverWatchId !== null) navigator.geolocation.clearWatch(driverWatchId); driverWatchId = null; return api('/api/driver/availability', { method: 'POST', body: JSON.stringify({ online: false }) }).then(() => driverOverview()).catch(e => alert(e.message)) } if (!navigator.geolocation) return alert('Location is not supported by this browser.'); navigator.geolocation.getCurrentPosition(async pos => { try { await api('/api/driver/availability', { method: 'POST', body: JSON.stringify({ online: true, lat: pos.coords.latitude, lng: pos.coords.longitude }) }); if (driverWatchId === null) driverWatchId = navigator.geolocation.watchPosition(p => api('/api/driver/availability', { method: 'POST', body: JSON.stringify({ online: true, lat: p.coords.latitude, lng: p.coords.longitude }) }).catch(() => { }), () => { }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }); await driverOverview() } catch (e) { alert(e.message) } }, () => alert('Please allow location access to go online.'), { enableHighAccuracy: true, timeout: 12000 }); };
}
async function driverRequests() {
  const d = await api('/api/driver/requests');
  $('#dashContent').innerHTML = panel('Available ride requests', d.rides.map(r => `<div class="ride-card"><strong>${esc(r.pickup)} → ${esc(r.destination)}</strong><p>Customer: ${esc(r.customer_name)} · ${new Date(r.requested_at).toLocaleString()}</p><button class="action" onclick="acceptRide('${r.id}')">Accept request</button></div>`).join('') || '<p class="empty">No requests at the moment.</p>');
}
window.acceptRide = async id => { try { await api(`/api/rides/${id}/accept`, { method: 'POST', body: '{}' }); const fare = prompt('Enter your proposed fare (BDT):'); if (fare) await api(`/api/rides/${id}/offer`, { method: 'POST', body: JSON.stringify({ fare }) }); await driverRequests() } catch (e) { alert(e.message) } };
async function customerOverview() {
  const d = await api('/api/rides/mine'), rides = d.rides;
  $('#dashContent').innerHTML = `<div class="stat-grid">${stat('Your bookings', rides.length)}${stat('Completed rides', rides.filter(r => r.status === 'completed').length)}${stat('Active rides', rides.filter(r => !['completed', 'cancelled', 'declined'].includes(r.status)).length)}</div>${panel('Welcome to RideFlow', '<p class="empty">Start by entering your pickup and destination in Book a ride. You can review driver offers in My rides.</p>')}`;
}
async function booking() {
  $('#dashContent').innerHTML = panel('Find a nearby driver', `<form id="bookForm">
  <label>Pickup location<input name="pickup" id="pickupInput" required placeholder="Search pickup address" autocomplete="off"><div id="pickupSuggestions" class="suggestions"></div></label>
  <button type="button" class="action geocode" id="pickupSearch">Find on map</button>
  <label>Destination<input name="destination" id="destinationInput" required placeholder="Search destination" autocomplete="off"><div id="destinationSuggestions" class="suggestions"></div></label>
  <button type="button" class="action geocode" id="destinationSearch">Find on map</button>
  <div id="rideMap" class="ride-map"></div>
  <p class="hint">Search each address to place its pin on the map. You can also click the map after choosing which location to adjust.</p>
  <input type="hidden" name="pickup_lat" id="pickupLat"><input type="hidden" name="pickup_lng" id="pickupLng">
  <input type="hidden" name="destination_lat" id="destinationLat"><input type="hidden" name="destination_lng" id="destinationLng">
  <div class="range-row"><label class="range-label">Search radius: <b id="rangeValue">15 km</b>
    <input type="range" id="radiusSlider" min="1" max="50" value="15" step="1"></label></div>
  <button class="btn" type="submit">Find available drivers ↗</button>
 </form><div id="driverResults"></div>`);

  const map = L.map('rideMap').setView([23.8103, 90.4125], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map);
  let pickupMarker = null, destMarker = null, routeLine = null, activePin = 'pickup';

  const setPin = (kind, latlng, label) => {
    const marker = kind === 'pickup' ? pickupMarker : destMarker; if (marker) map.removeLayer(marker);
    const next = L.marker(latlng).addTo(map).bindPopup(label);
    if (kind === 'pickup') { pickupMarker = next; $('#pickupLat').value = latlng.lat; $('#pickupLng').value = latlng.lng }
    else { destMarker = next; $('#destinationLat').value = latlng.lat; $('#destinationLng').value = latlng.lng }
    if (pickupMarker && destMarker) {
      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.polyline([pickupMarker.getLatLng(), destMarker.getLatLng()], { color: '#b6f36b', weight: 4, dashArray: '7 7' }).addTo(map);
      map.fitBounds(routeLine.getBounds().pad(.2));
      fetch(`https://router.project-osrm.org/route/v1/driving/${pickupMarker.getLatLng().lng},${pickupMarker.getLatLng().lat};${destMarker.getLatLng().lng},${destMarker.getLatLng().lat}?overview=full&geometries=geojson`)
        .then(r => r.json()).then(data => { if (data.routes?.[0]) { map.removeLayer(routeLine); routeLine = L.geoJSON(data.routes[0].geometry, { style: { color: '#b6f36b', weight: 5 } }).addTo(map); map.fitBounds(routeLine.getBounds().pad(.2)) } }).catch(() => { })
    } else map.setView(latlng, 14)
  };

  // Autocomplete for pickup / destination
  attachAutocomplete($('#pickupInput'), $('#pickupSuggestions'), item => { setPin('pickup', L.latLng(item.lat, item.lon), item.display_name); $('#pickupInput').value = item.display_name; });
  attachAutocomplete($('#destinationInput'), $('#destinationSuggestions'), item => { setPin('destination', L.latLng(item.lat, item.lon), item.display_name); $('#destinationInput').value = item.display_name; });

  $('#pickupInput').onfocus = () => activePin = 'pickup';
  $('#destinationInput').onfocus = () => activePin = 'destination';
  map.on('click', e => { const label = activePin === 'pickup' ? 'Pickup location' : 'Destination'; setPin(activePin, e.latlng, label); });

  // Radius slider display
  const slider = $('#radiusSlider');
  slider.oninput = () => $('#rangeValue').textContent = slider.value + ' km';

  $('#bookForm').onsubmit = async e => {
    e.preventDefault();
    if (!pickupMarker || !destMarker) return alert('Find both pickup and destination on the map first.');
    const radius = Number(slider.value) || 15;
    try {
      const d = await api(`/api/drivers/nearby?lat=${pickupMarker.getLatLng().lat}&lng=${pickupMarker.getLatLng().lng}&radius=${radius}`);
      const results = $('#driverResults');
      results.innerHTML = panel(`Available drivers within ${radius} km (${d.drivers.length})`,
        (d.drivers.map(x => driverCard(x)).join('')) ||
        '<p class="empty">No online approved drivers in this range. Try expanding the search radius.</p>');
    } catch (err) { alert(err.message) }
  };
}

/* --- helper: driver card with expand/collapse + animation (Feature v + vi) --- */
function driverCard(x) {
  const avatar = x.profile_photo ? `/api/media/profile/${x.id}` : '/avatar-placeholder.svg';
  const rating = Number(x.rating) > 0 ? `★ ${Number(x.rating).toFixed(1)}` : 'New driver';
  const vehiclePhoto = x.photo_file ? `/api/media/vehicle/${x.id}` : '/avatar-placeholder.svg';
  return `<article class="driver-option" data-driver="${x.id}" onclick="toggleDriver('${x.id}')">
   <div class="driver-summary">
     <img class="avatar large" src="${avatar}" onerror="this.src='/avatar-placeholder.svg'">
     <div class="driver-main">
       <b>${esc(x.name)}</b>
       <span class="driver-rating">${rating} · ${Number(x.distance_km).toFixed(1)} km away</span>
       <small>${esc(x.make_model)} · ${esc(x.vehicle_size || x.vehicle_type || 'Vehicle')}</small>
       <small>${esc(x.vehicle_type)} · ${esc(x.registration_number)}</small>
     </div>
     <span class="online-pill">● Active</span>
   </div>
   <div class="driver-expanded hidden" id="driver-${x.id}">
     <img class="vehicle-photo" src="${vehiclePhoto}" onerror="this.src='/avatar-placeholder.svg'">
     <div class="driver-meta-grid">
       <div><small>Mobile</small><b>${esc(x.mobile)}</b></div>
       <div><small>Vehicle</small><b>${esc(x.make_model)}</b></div>
       <div><small>Type</small><b>${esc(x.vehicle_type)}</b></div>
       <div><small>Size</small><b>${esc(x.vehicle_size || '—')}</b></div>
       <div><small>Color</small><b>${esc(x.color || '—')}</b></div>
       <div><small>Registration</small><b>${esc(x.registration_number)}</b></div>
     </div>
     <p>${esc(x.vehicle_details || 'No additional vehicle details provided.')}</p>
     <button class="btn" type="button" onclick="event.stopPropagation();requestSelectedDriver('${x.id}','${x.vehicle_id}')">Request this driver ↗</button>
   </div>
 </article>`;
}
window.toggleDriver = id => { $('#driver-' + id)?.classList.toggle('hidden') };
window.requestSelectedDriver = async (driver_id, vehicle_id) => { const pickup = $('#pickupInput').value, destination = $('#destinationInput').value; try { const r = await api('/api/rides', { method: 'POST', body: JSON.stringify({ pickup, destination, driver_id, vehicle_id, pickup_lat: $('#pickupLat').value, pickup_lng: $('#pickupLng').value, destination_lat: $('#destinationLat').value, destination_lng: $('#destinationLng').value }) }); activeRide = r.ride; alert('Ride request sent to your selected driver.'); await loadView('My rides') } catch (e) { alert(e.message) } };
async function profilePage() {
  const { profile: p } = await api('/api/profile'); const avatar = p.profile_photo ? `/api/media/profile/${p.id}` : '/avatar-placeholder.svg';
  const field = (label, name, value = '') => `<label>${label}<input name="${name}" value="${esc(value || '')}"></label>`;
  $('#dashContent').innerHTML = panel('Your profile', `<div class="profile-header"><img class="avatar profile-avatar" src="${avatar}" onerror="this.src='/avatar-placeholder.svg'"><div><h3>${esc(p.name)}</h3><small>${esc(p.role)} · ${esc(p.mobile)}</small></div></div><form id="profileForm"><div class="form-grid">${field('Full name', 'name', p.name)}${field('Mobile number', 'mobile', p.mobile)}${field('Email', 'email', p.email)}${field('Present address', 'present_address', p.present_address)}${field('Permanent address', 'permanent_address', p.permanent_address)}${p.role === 'driver' ? field('Vehicle make / model', 'make_model', p.make_model) + field('Vehicle type', 'vehicle_type', p.vehicle_type) + field('Vehicle size', 'vehicle_size', p.vehicle_size) + field('Vehicle color', 'color', p.color) + `<label class="wide">Vehicle details<textarea name="vehicle_details">${esc(p.vehicle_details || '')}</textarea></label>` : ''}</div><button class="btn">Save profile changes</button></form><hr><form id="photoForm" enctype="multipart/form-data"><div class="form-grid"><label>Profile picture<input name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp"></label>${p.role === 'driver' ? '<label>Vehicle picture<input name="vehiclePhoto" type="file" accept="image/jpeg,image/png,image/webp"></label>' : ''}</div><button class="action">Upload selected pictures</button></form><div class="detail-actions"><button class="action danger" id="removeProfilePhoto">Remove profile picture</button>${p.role === 'driver' ? '<button class="action danger" id="removeVehiclePhoto">Remove vehicle picture</button>' : ''}</div><p id="profileMessage" class="message"></p>${p.role === 'driver' && p.photo_file ? `<div><b>Current vehicle picture</b><br><img class="vehicle-photo" src="/api/media/vehicle/${p.id}"></div>` : ''}`)
    + panel('Change password', `<p class="hint">Choose a strong password of at least 10 characters. You'll stay signed in.</p><form id="passwordForm" autocomplete="off"><div class="form-grid"><label>Current password<input name="current_password" type="password" required autocomplete="current-password"></label><label>New password<input name="new_password" type="password" minlength="10" required autocomplete="new-password"></label><label>Confirm new password<input name="confirm_password" type="password" minlength="10" required autocomplete="new-password"></label></div><button class="btn">Update password</button><p id="passwordMessage" class="message"></p></form>`);
  $('#profileForm').onsubmit = async e => { e.preventDefault(); try { await api('/api/profile', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); $('#profileMessage').textContent = 'Profile updated.'; const me = await api('/api/me'); currentUser = me.user; $('#sideUser').innerHTML = `<b>${esc(currentUser.name)}</b>${esc(currentUser.mobile)}` } catch (err) { $('#profileMessage').textContent = err.message } };
  $('#photoForm').onsubmit = async e => { e.preventDefault(); try { await api('/api/profile/photos', { method: 'POST', body: new FormData(e.target) }); $('#profileMessage').textContent = 'Photos updated.'; await profilePage() } catch (err) { $('#profileMessage').textContent = err.message } };
  $('#removeProfilePhoto').onclick = async () => { try { await api('/api/profile/photos/profile', { method: 'DELETE' }); await profilePage() } catch (e) { alert(e.message) } };
  if (p.role === 'driver') $('#removeVehiclePhoto').onclick = async () => { try { await api('/api/profile/photos/vehicle', { method: 'DELETE' }); await profilePage() } catch (e) { alert(e.message) } };
  const pwForm = $('#passwordForm');
  if (pwForm) pwForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(pwForm));
    if (data.new_password !== data.confirm_password) { $('#passwordMessage').textContent = 'New passwords do not match.'; return; }
    try { await api('/api/change-password', { method: 'POST', body: JSON.stringify({ current_password: data.current_password, new_password: data.new_password }) }); $('#passwordMessage').textContent = 'Password updated successfully.'; pwForm.reset(); }
    catch (err) { $('#passwordMessage').textContent = err.message }
  };
}
async function myRides(){
  const d = await api('/api/rides/mine');
  $('#dashContent').innerHTML=panel('Your rides',d.rides.map(r=>`
    <div class="ride-card">
      <strong>${esc(r.pickup)} → ${esc(r.destination)}</strong>
      <p>Status: ${esc(r.status)} ${r.payment_status==='paid' ? '· <span style="color:#c7f36b">Paid</span>' : ''} · Requested ${new Date(r.requested_at).toLocaleString()}</p>
      ${r.offered_fare?`<p>Driver offer: ৳${r.offered_fare}</p>`:''}
      
      ${currentUser.role==='customer'&&r.status==='offered'?`<button class="action" onclick="confirmFare('${r.id}')">Accept fare</button>`:''}
      ${currentUser.role==='driver'&&r.status==='confirmed'?`<button class="action" onclick="startRide('${r.id}')">Start ride</button>`:''}
      ${currentUser.role==='driver'&&r.status==='started'?`<button class="action" onclick="completeRide('${r.id}')">Complete ride</button>`:''}
      ${['accepted','offered','confirmed','started'].includes(r.status)?`<button class="action" onclick="openChat('${r.id}')">Open chat</button>`:''}
      ${['requested','accepted','offered','confirmed'].includes(r.status)?`<button class="action danger" onclick="cancelRide('${r.id}')">Cancel</button>`:''}
      
      <!-- NEW PAYMENT & RATING LOGIC -->
      ${currentUser.role==='customer' && r.status==='completed' && r.payment_status==='unpaid' ? 
        `<button class="btn" style="margin-top:10px; padding: 8px 15px; font-size: 12px;" onclick="payRide('${r.id}', ${r.final_fare})">Pay ৳${r.final_fare} from Wallet</button>` : ''}
      
      ${currentUser.role==='customer' && r.status==='completed' && r.payment_status==='paid' && !r.driver_rating ? 
        `<div style="margin-top:10px; padding-top:10px; border-top:1px solid #35445a;">
           <b>Rate your driver:</b>
           <div style="margin-top:5px;">
             ${[1,2,3,4,5].map(star => `<button class="action" style="font-size:20px; padding:0 5px;" onclick="rateDriver('${r.id}', ${star})">★</button>`).join('')}
           </div>
         </div>` : ''}
    </div>
  `).join('')||'<p class="empty">No rides yet.</p>')+'<div id="chatPanel"></div>';
}

window.payRide = async (id, fare) => {
  if(!confirm(`Pay ৳${fare} from your wallet?`)) return;
  try {
    await api(`/api/rides/${id}/pay`, { method: 'POST' });
    alert('Payment successful!');
    await myRides();
  } catch(e) { alert(e.message); }
};

window.rateDriver = async (id, stars) => {
  const feedback = prompt('Optional: Leave a comment for the driver');
  try {
    await api(`/api/rides/${id}/rate`, { method: 'POST', body: JSON.stringify({ rating: stars, feedback }) });
    alert('Rating submitted. Thank you!');
    await myRides();
  } catch(e) { alert(e.message); }
};
window.confirmFare = async id => { try { await api(`/api/rides/${id}/confirm`, { method: 'POST', body: '{}' }); await myRides() } catch (e) { alert(e.message) } };
window.startRide = async id => { try { await api(`/api/rides/${id}/start`, { method: 'POST', body: '{}' }); await myRides() } catch (e) { alert(e.message) } };
window.completeRide = async id => { try { await api(`/api/rides/${id}/complete`, { method: 'POST', body: '{}' }); await myRides() } catch (e) { alert(e.message) } };
window.cancelRide = async id => { if (!confirm('Cancel this ride?')) return; try { await api(`/api/rides/${id}/cancel`, { method: 'POST', body: '{}' }); await myRides() } catch (e) { alert(e.message) } };
window.openChat = async id => {
  try {
    const d = await api(`/api/rides/${id}/messages`);
    $('#chatPanel').innerHTML = panel('Ride chat', `<div class="chat-box" id="chatBox">${d.messages.map(m => `<div class="chat-line ${m.sender_id === currentUser.id ? 'mine' : ''}"><img class="avatar chat-avatar" src="${m.profile_photo ? `/api/media/profile/${m.sender_id}` : '/avatar-placeholder.svg'}" onerror="this.src='/avatar-placeholder.svg'"><span><b>${esc(m.sender_name)}:</b> ${esc(m.message)}</span></div>`).join('')}</div><form id="chatForm" class="inline-form"><label>Message<input name="message" required maxlength="2000" placeholder="Write a message..."></label><button class="btn">Send</button></form>`);
    if (socket) { socket.emit('ride:join', id); socket.off('chat:message'); socket.on('chat:message', m => { if (m.ride_id !== id) return; const box = $('#chatBox'); box.insertAdjacentHTML('beforeend', `<div class="chat-line ${m.sender_id === currentUser.id ? 'mine' : ''}"><img class="avatar chat-avatar" src="${m.profile_photo ? `/api/media/profile/${m.sender_id}` : '/avatar-placeholder.svg'}" onerror="this.src='/avatar-placeholder.svg'"><span><b>${esc(m.sender_name)}:</b> ${esc(m.message)}</span></div>`); box.scrollTop = box.scrollHeight }) }
    $('#chatForm').onsubmit = async e => { e.preventDefault(); const message = new FormData(e.target).get('message'); try { await api(`/api/rides/${id}/messages`, { method: 'POST', body: JSON.stringify({ message }) }); e.target.reset() } catch (err) { alert(err.message) } };
  } catch (e) { alert(e.message) }
};
/* ============================================================
   Autocomplete helper (Feature ii) — Nominatim via /api/geocode
   ============================================================ */
function attachAutocomplete(inputEl, suggestionBox, onPick) {
  if (!inputEl || !suggestionBox) return;
  let timer = null, ctrl = null;
  const clear = () => { suggestionBox.innerHTML = ''; suggestionBox.classList.remove('open'); };
  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inputEl.value.trim();
    if (q.length < 3) { clear(); return; }
    timer = setTimeout(async () => {
      try {
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        const { results } = await api('/api/geocode?q=' + encodeURIComponent(q));
        if (!results.length) { clear(); return; }
        suggestionBox.innerHTML = results.map((r, i) => `<button type="button" class="suggestion" data-i="${i}">${esc(r.display_name)}</button>`).join('');
        suggestionBox.classList.add('open');
        suggestionBox.querySelectorAll('.suggestion').forEach(b => {
          b.onclick = () => { const r = results[+b.dataset.i]; onPick(r); clear(); };
        });
      } catch (e) { clear(); }
    }, 280);
  });
  // Close when focus leaves the combo
  document.addEventListener('click', e => {
    if (!suggestionBox.contains(e.target) && e.target !== inputEl) clear();
  });
  inputEl.addEventListener('keydown', e => { if (e.key === 'Escape') clear(); });
}
boot();
/* ---------------- WALLET VIEWS ---------------- */
async function walletPage(){
  const d = await api('/api/wallet');
  const isCustomer = currentUser.role === 'customer';
  const methods = [
    { id: 'bkash', name: 'Bkash', num: d.paymentNumbers.bkash_number || 'Not set' },
    { id: 'rocket', name: 'Rocket', num: d.paymentNumbers.rocket_number || 'Not set' },
    { id: 'upay', name: 'Upay', num: d.paymentNumbers.upay_number || 'Not set' }
  ];

  $('#dashContent').innerHTML = `
    <div class="stat-grid" style="grid-template-columns: 1fr;">
      <div class="stat" style="background: linear-gradient(135deg, #1b2940, #151f30); border-color: #c7f36b;">
        <small>${esc(currentUser.name)}'s Wallet Balance</small>
        <strong style="font-size: 40px;">৳${d.balance}</strong>
      </div>
    </div>
    
    ${panel('Load Money into Wallet', `
      <p class="hint">Select a method, send the money to the number below, and submit the Transaction ID here.</p>
      <div class="payment-methods">
        ${methods.map(m => `
          <label class="pay-method">
            <input type="radio" name="pay_method" value="${m.id}">
            <div class="pay-box">
              <b>${m.name}</b>
              <small>${m.num}</small>
            </div>
          </label>
        `).join('')}
      </div>
      
      <form id="depositForm" style="margin-top: 20px;">
        <div class="form-grid">
          <label>Amount (৳)<input type="number" name="amount" required min="10" placeholder="e.g. 500"></label>
          <label>Your Phone Number<input type="text" name="phone_number" required placeholder="01XXXXXXXXX" pattern="01[3-9][0-9]{8}" title="Please enter a valid 11-digit BD phone number"></label>
          <label class="wide">Transaction ID<input type="text" name="transaction_id" required placeholder="e.g. TR00112233"></label>
        </div>
        <button class="btn" type="submit">Request Load Money</button>
        <p id="depositMessage" class="message"></p>
      </form>
    `)}
    
    ${panel('Transaction History', `
      ${table(['Date', 'Type', 'Amount', 'Status', 'Method/Feedback'], d.transactions.map(t => `
        <tr>
          <td>${new Date(t.created_at).toLocaleString()}</td>
          <td style="text-transform: capitalize;">${esc(t.type.replace('_', ' '))}</td>
          <td style="color: ${t.type === 'deposit' || t.type === 'ride_earning' ? '#c7f36b' : '#ff9292'}">
            ${t.type === 'deposit' || t.type === 'ride_earning' ? '+' : '-'}৳${t.amount}
          </td>
          <td><span class="status-pill ${t.status}">${esc(t.status)}</span></td>
          <td>${esc(t.method || '')} ${t.admin_feedback ? `<br><small style="color:#ff9292">${esc(t.admin_feedback)}</small>` : ''}</td>
        </tr>
      `).join(''))}
    `)}
  `;

  // Handle Form Submission with explicit Radio Button checking
  $('#depositForm').onsubmit = async e => {
    e.preventDefault();
    
    // Get standard text inputs
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    
    // Manually get the selected radio button
    const selectedMethod = document.querySelector('input[name="pay_method"]:checked');
    
    if (!selectedMethod) {
      $('#depositMessage').textContent = 'Please select a payment method (Bkash, Rocket, or Upay).';
      $('#depositMessage').style.color = '#ff9292';
      return;
    }
    
    // Attach the selected method to our data object
    data.method = selectedMethod.value;

    try {
      const res = await api('/api/wallet/deposit', { method: 'POST', body: JSON.stringify(data) });
      
      // Show success message
      $('#depositMessage').textContent = res.message;
      $('#depositMessage').style.color = '#c7f36b';
      
      // Reset the form inputs
      e.target.reset();
      
      // Visually uncheck the custom radio boxes
      document.querySelectorAll('.pay-method input').forEach(i => i.checked = false);
      
      // Optional: Reload the wallet page after 2.5 seconds to show the pending transaction in the table
      setTimeout(() => {
        if ($('#dashTitle').textContent === 'Wallet') {
          loadView('Wallet');
        }
      }, 2500);

    } catch(err) { 
      $('#depositMessage').textContent = err.message; 
      $('#depositMessage').style.color = '#ff9292';
    }
  };
}

/* ---------------- ADMIN VIEWS ---------------- */
async function adminTransactions(){
  const d = await api('/api/admin/transactions');
  const pending = await api('/api/admin/transactions/pending');

  $('#dashContent').innerHTML = `
    ${panel('Pending Deposit Requests', pending.transactions.length ? pending.transactions.map(t => `
      <div class="ride-card">
        <strong>${esc(t.user_name)} (${esc(t.user_mobile)})</strong>
        <p>Amount: <b>৳${t.amount}</b> · Method: ${esc(t.method)} · Phone: ${esc(t.phone_number)} · TrxID: ${esc(t.transaction_id)}</p>
        <div class="inline-form" style="margin-top:10px;">
          <input placeholder="Reject reason (if any)" id="fb-${t.id}" style="flex:1;">
          <button class="action" onclick="processTx('${t.id}', 'approve')">Approve</button>
          <button class="action danger" onclick="processTx('${t.id}', 'reject')">Reject</button>
        </div>
      </div>
    `).join('') : '<p class="empty">No pending requests.</p>')}
    ${panel('All Transactions', table(['Date', 'User', 'Type', 'Amount', 'Status', 'Details'], d.transactions.map(t => `
      <tr>
        <td>${new Date(t.created_at).toLocaleString()}</td>
        <td>${esc(t.user_name)}</td>
        <td style="text-transform: capitalize;">${esc(t.type.replace('_', ' '))}</td>
        <td>৳${t.amount}</td>
        <td><span class="status-pill ${t.status}">${esc(t.status)}</span></td>
        <td>${t.method ? esc(t.method) + ' - ' + esc(t.transaction_id) : ''} ${t.driver_name ? 'To Driver: ' + esc(t.driver_name) : ''}</td>
      </tr>
    `).join('')))}
  `;
}

window.processTx = async (id, action) => {
  const feedback = $('#fb-' + id)?.value || '';
  try {
    await api(`/api/admin/transactions/${id}/process`, { method: 'POST', body: JSON.stringify({ action, feedback }) });
    await adminTransactions();
  } catch(e) { alert(e.message); }
};

async function adminSettings(){
  const d = await api('/api/wallet'); // Reuse endpoint to get settings
  $('#dashContent').innerHTML = panel('Payment Numbers', `
    <form id="settingsForm">
      <div class="form-grid">
        <label>Bkash Number<input name="bkash_number" value="${esc(d.paymentNumbers.bkash_number || '')}"></label>
        <label>Rocket Number<input name="rocket_number" value="${esc(d.paymentNumbers.rocket_number || '')}"></label>
        <label>Upay Number<input name="upay_number" value="${esc(d.paymentNumbers.upay_number || '')}"></label>
      </div>
      <button class="btn">Save Numbers</button>
      <p id="settingsMsg" class="message"></p>
    </form>
  `);
  $('#settingsForm').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/api/admin/settings/payments', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      $('#settingsMsg').textContent = 'Settings saved!';
    } catch(err) { $('#settingsMsg').textContent = err.message; }
  };
}