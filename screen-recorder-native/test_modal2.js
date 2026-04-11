const modal = document.getElementById('modal');
const body = document.body;
console.log('modal pos:', window.getComputedStyle(modal).position);
console.log('html transform:', window.getComputedStyle(document.documentElement).transform);
console.log('body transform:', window.getComputedStyle(body).transform);
