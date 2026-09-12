const requests = new WeakMap();

// Keep the previous decoded bitmap invisible until this exact request is ready.
export function loadGalleryImage(image, src, ready = () => {}, failed = () => {}) {
  cancelGalleryImage(image);
  const request = {};
  requests.set(image, request);
  image.style.visibility = 'hidden';
  const current = () => requests.get(image) === request;
  const finish = () => {
    if (!current() || !image.naturalWidth) return;
    image.style.visibility = 'visible'; ready();
  };
  const error = () => { if (current()) { image.style.visibility = 'hidden'; failed(); } };
  const loaded = () => {
    if (typeof image.decode !== 'function') finish();
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', error);
  request.cleanup = () => { image.removeEventListener('load', loaded); image.removeEventListener('error', error); };
  image.src = src;
  // decode also covers cached images; its promise rejects if src changes.
  if (typeof image.decode === 'function') image.decode().then(finish, error);
}

export function cancelGalleryImage(image) {
  requests.get(image)?.cleanup();
  requests.delete(image);
  image.style.visibility = 'hidden';
}
