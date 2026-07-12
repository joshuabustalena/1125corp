/*
  Interest rates are always monthly now, so the "/ 60 days" and "/ 3 months"
  suffixes in loan type names are no longer accurate — strip them, leaving
  just the percentage. Run once in SQL Editor.
*/
update loan_types set name = regexp_replace(name, '\s*/\s*.*$', '');
