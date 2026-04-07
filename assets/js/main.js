document.addEventListener('DOMContentLoaded', function() {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav-links');

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

  // Mobile dropdown accordions
  var dropdowns = document.querySelectorAll('.nav-dropdown');
  dropdowns.forEach(function(dropdown) {
    var trigger = dropdown.querySelector('.dropdown-trigger');
    if (trigger) {
      trigger.addEventListener('click', function(e) {
        if (window.innerWidth <= 640) {
          e.preventDefault();
          dropdown.classList.toggle('open');
          // Close other dropdowns
          dropdowns.forEach(function(other) {
            if (other !== dropdown) other.classList.remove('open');
          });
        }
      });
    }
  });
});
