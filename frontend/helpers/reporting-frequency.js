const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");

export function readReportingFrequency(row) {
  const { complete_checklists, reporting_checklists } = row;
  if (complete_checklists === null && reporting_checklists === null) return null;
  const complete = Number(complete_checklists);
  const reports = Number(reporting_checklists);
  if (reporting_checklists === null || reporting_checklists === "" ||
      !Number.isSafeInteger(complete) || complete <= 0 ||
      !Number.isSafeInteger(reports) || reports < 0 || reports > complete) {
    throw new Error("Invalid reporting checklist counts");
  }
  return { complete, reports, rate: reports / complete };
}

export function formatFrequency(rate) {
  return rate > 0 && rate < 0.0005 ? "<0.1%" : percent.format(rate);
}

export function formatChecklistCounts({ reports, complete }) {
  return integer.format(reports) + " / " + integer.format(complete) + " complete checklists";
}
