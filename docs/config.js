// Group Signup — site configuration
//
// One entry per course. The key is what appears in the URL (?c=pol2230), so keep
// it short and URL-safe. The url is the Apps Script web app deployed from that
// course's Google Sheet; it looks like
//   https://script.google.com/macros/s/AKfycb.../exec
// The label is shown on the course chooser when more than one course is listed.
//
// Leave COURSES empty to run the page in demo mode (fake in-browser data, nothing saved).
window.GROUP_SIGNUP_CONFIG = {
  COURSES: {
    'pol3540': {
      url: 'https://script.google.com/macros/s/AKfycbyJyvxZrsy3ljC1fDL62845jVJ14R-IcEUWz114wrbfDjbL7lVMR8CPyHHdj4j9J_2bRw/exec',
      label: 'POL 3540 — Politics of Immigration and Citizenship (Fall 2026)'
    }
  }
};
