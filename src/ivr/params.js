// ימות המשיח שולח בכל בקשה את כל התשובות שנאספו במהלך השיחה עד כה,
// כך שאם אותו שם פרמטר (למשל BED_COUNT) נשאל כמה פעמים באותה שיחה,
// req.query[name] יגיע כמערך של כל התשובות ההיסטוריות ולא רק כערך
// האחרון. יש להשתמש בפונקציה הזו בכל מקום שקוראים פרמטר תשובה מהשיחה.
function last(query, name) {
  const v = query[name];
  if (Array.isArray(v)) return v[v.length - 1];
  return v;
}

module.exports = { last };
