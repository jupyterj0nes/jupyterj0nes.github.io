// Mobile nav toggle
document.addEventListener('DOMContentLoaded', function() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav-links');

  if (toggle && nav) {
    toggle.addEventListener('click', function() {
      nav.classList.toggle('active');
    });

    document.addEventListener('click', function(e) {
      if (!toggle.contains(e.target) && !nav.contains(e.target)) {
        nav.classList.remove('active');
      }
    });
  }
});
