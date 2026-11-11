// Apply the saved preference before the main renderer initializes.
let theme = 'light';
try {
  if (localStorage.getItem('resos:theme') === 'dark') theme = 'dark';
} catch {
  // Keep the default when local preference storage is unavailable.
}
document.documentElement.dataset.theme = theme;
