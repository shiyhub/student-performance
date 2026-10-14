async () => {
  try { localStorage.setItem('sp_identity', JSON.stringify({ class: '六年级一班', studentName: '卿泽懿' })); } catch (e) {}
  location.reload();
  await new Promise(r => setTimeout(r, 60));
}
