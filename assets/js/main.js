document.addEventListener('DOMContentLoaded', function() {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav-links');

  if (toggle && nav) {
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      nav.classList.toggle('active');
    });

    document.addEventListener('click', function(e) {
      if (!toggle.contains(e.target) && !nav.contains(e.target)) {
        nav.classList.remove('active');
      }
    });
  }

  // Mobile dropdown accordions
  var dropdowns = document.querySelectorAll('.nav-dropdown');
  dropdowns.forEach(function(dropdown) {
    var trigger = dropdown.querySelector('.dropdown-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', function(e) {
      // Only intercept on mobile
      if (window.innerWidth > 640) return;

      e.preventDefault();
      e.stopPropagation();

      var isOpen = dropdown.classList.contains('open');

      // Close all dropdowns first
      dropdowns.forEach(function(d) { d.classList.remove('open'); });

      // Toggle the clicked one
      if (!isOpen) {
        dropdown.classList.add('open');
      }
    });

    // Also handle touchend to avoid double-tap issues on iOS Safari
    trigger.addEventListener('touchend', function(e) {
      if (window.innerWidth > 640) return;

      e.preventDefault();
      e.stopPropagation();

      var isOpen = dropdown.classList.contains('open');
      dropdowns.forEach(function(d) { d.classList.remove('open'); });
      if (!isOpen) {
        dropdown.classList.add('open');
      }
    });
  });
});
