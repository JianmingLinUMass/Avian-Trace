
const container = d3.select("#matrix-container");
const svg = d3.select("#matrix");
const tooltip = d3.select("#tooltip");

const formatAmount = d3.format(",.2f");
const formatInteger = d3.format(",");

// Layout settings
const cellSize = 28;
const leftMargin = 210;
const topMargin = 230;
const rightMargin = 40;
const bottomMargin = 40;
const numOfRecipients = 200;

let zoom = 1;
let matrixWidth = 0;
let matrixHeight = 0;

// Zooming uses an enlarged SVG and scrollbars.
// This avoids physics and keeps all cells in
// fixed positions.
function setZoom(newZoom) {
    zoom = Math.max(0.5, Math.min(3, newZoom));

    svg
        .attr("width", matrixWidth * zoom)
        .attr("height", matrixHeight * zoom);

    svg.select("#matrix-content")
        .attr("transform", `scale(${zoom})`);

    d3.select("#zoom-level")
        .text(`${Math.round(zoom * 100)}%`);
}

// Zoom buttons
d3.select("#zoom-in").on("click", () => {
    setZoom(zoom * 1.25);
});

d3.select("#zoom-out").on("click", () => {
    setZoom(zoom / 1.25);
});

d3.select("#zoom-reset").on("click", () => {
    setZoom(1);
});

// Ctrl + mouse wheel zoom
container.node().addEventListener(
    "wheel",
    event => {
        if (!event.ctrlKey) return;

        event.preventDefault();

        const factor = event.deltaY < 0
            ? 1.1
            : 1 / 1.1;

        setZoom(zoom * factor);
    },
    { passive: false }
);

// Load and process CSV
d3.csv("Aid.csv", d => ({
    donor: d["Donor name"]?.trim(),
    recipient: d["Recipient name"]?.trim(),
    amount: +d.Amount
})).then(rawData => {

    // Filter invalid records
    const data = rawData.filter(d =>
        d.donor &&
        d.recipient &&
        Number.isFinite(d.amount) &&
        d.amount > 0 &&
        !/unspecified/i.test(d.donor) &&
        !/unspecified/i.test(d.recipient)
    );

    if (data.length === 0) {
        d3.select("#status").text("No valid aid records");
        return;
    }

    // Total donated by each donor
    const donated = d3.rollup(
        data,
        v => d3.sum(v, d => d.amount),
        d => d.donor
    );

    // Total received by each recipient
    const received = d3.rollup(
        data,
        v => d3.sum(v, d => d.amount),
        d => d.recipient
    );

    // Sort donors: largest total first
    const donors = Array.from(donated)
        .sort((a, b) =>
            d3.descending(a[1], b[1])
        )
        .map(d => d[0]);

    // Sort recipients: largest total first
    const recipients = Array.from(received)
        .sort((a, b) =>
            d3.descending(a[1], b[1])
        )
        .slice(0, numOfRecipients)
        .map(d => d[0]);

    // Aggregate donor-recipient relationships
    const grouped = d3.rollup(
        data,
        v => d3.sum(v, d => d.amount),
        d => d.donor,
        d => d.recipient
    );

    const selectedRecipients = new Set(recipients);
    const cells = [];

    for (const [donor, targets] of grouped) {
        for (const [recipient, amount] of targets) {
            if (!selectedRecipients.has(recipient)) continue;
    
            cells.push({
                donor,
                recipient,
                amount
            });
        }
    }

    console.log("Donors:", donors.length);
    console.log("Recipients:", recipients.length);
    console.log("Relationships:", cells.length);

    // -------------------------------
    // MATRIX DIMENSIONS
    // -------------------------------

    const gridWidth = recipients.length * cellSize;
    const gridHeight = donors.length * cellSize;

    matrixWidth =
        leftMargin + gridWidth + rightMargin;

    matrixHeight =
        topMargin + gridHeight + bottomMargin;

    svg
        .attr("width", matrixWidth)
        .attr("height", matrixHeight);

    const root = svg.append("g")
        .attr("id", "matrix-content");

    // -------------------------------
    // SCALES
    // -------------------------------

    const x = d3.scaleBand()
        .domain(recipients)
        .range([
            leftMargin,
            leftMargin + gridWidth
        ])
        .paddingInner(0.06);

    const y = d3.scaleBand()
        .domain(donors)
        .range([
            topMargin,
            topMargin + gridHeight
        ])
        .paddingInner(0.06);

    const maxAmount =
        d3.max(cells, d => d.amount) || 1;

    // Square-root color transformation:
    // helps make smaller contributions visible.
    const color = d3.scaleSequential()
        .domain([0, Math.sqrt(maxAmount)])
        .interpolator(d3.interpolateBlues);

    // -------------------------------
    // BACKGROUND
    // -------------------------------

    root.append("rect")
        .attr("x", leftMargin)
        .attr("y", topMargin)
        .attr("width", gridWidth)
        .attr("height", gridHeight)
        .attr("fill", "#f3f4f6");

    // -------------------------------
    // DRAW MATRIX CELLS
    // -------------------------------

    // Only draw positive-value relationships.
    // Unrecorded pairs remain light gray.
    const cell = root.append("g")
        .attr("class", "cells")
        .selectAll("rect")
        .data(cells)
        .join("rect")
        .attr("class", "cell")
        .attr("x", d => x(d.recipient))
        .attr("y", d => y(d.donor))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .attr("fill", d =>
            color(Math.sqrt(d.amount))
        );

    // -------------------------------
    // ROW LABELS
    // -------------------------------

    const rowLabels = root.append("g")
        .selectAll("text")
        .data(donors)
        .join("text")
        .attr("class", "row-label")
        .attr("x", leftMargin - 10)
        .attr("y", d =>
            y(d) + y.bandwidth() / 2
        )
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .text(d => d);

    // -------------------------------
    // COLUMN LABELS
    // -------------------------------

    const columnLabels = root.append("g")
        .selectAll("text")
        .data(recipients)
        .join("text")
        .attr("class", "column-label")
        .attr("transform", d => {
            const cx =
                x(d) + x.bandwidth() / 2;

            const cy = topMargin - 10;

            return `translate(${cx},${cy})
                    rotate(-55)`;
        })
        .attr("text-anchor", "start")
        .text(d => d);

    // -------------------------------
    // TOOLTIP INTERACTION
    // -------------------------------

    cell.on("mouseover", (event, d) => {
        tooltip
            .style("opacity", 1);

        // Build tooltip with text() so country
        // names are displayed as plain text.
        tooltip.html("");

        tooltip.append("strong")
            .text(`${d.donor} → ${d.recipient}`);

        tooltip.append("div")
            .text(
                `Aid amount: ${formatAmount(d.amount)}`
            );

        tooltip.append("div")
            .text(
                `Total donated by ${d.donor}: ` +
                formatAmount(donated.get(d.donor))
            );

        tooltip.append("div")
            .text(
                `Total received by ${d.recipient}: ` +
                formatAmount(received.get(d.recipient))
            );

        rowLabels
            .attr("font-weight", name =>
                name === d.donor ? "bold" : "normal"
            )
            .attr("fill", name =>
                name === d.donor ? "#2563eb" : "#333"
            );

        columnLabels
            .attr("font-weight", name =>
                name === d.recipient ? "bold" : "normal"
            )
            .attr("fill", name =>
                name === d.recipient ? "#2563eb" : "#333"
            );
    })
    .on("mousemove", event => {
        tooltip
            .style("left", `${event.pageX + 15}px`)
            .style("top", `${event.pageY + 15}px`);
    })
    .on("mouseout", () => {
        tooltip.style("opacity", 0);

        rowLabels
            .attr("font-weight", "normal")
            .attr("fill", "#333");

        columnLabels
            .attr("font-weight", "normal")
            .attr("fill", "#333");
    });

    // -------------------------------
    // STATUS
    // -------------------------------

    d3.select("#status").text(
        `${formatInteger(donors.length)} donors · ` +
        `${formatInteger(recipients.length)} recipients · ` +
        `${formatInteger(cells.length)} relationships`
    );

    console.log("Aid matrix rendered successfully");

}).catch(error => {
    console.error("Error loading Aid.csv:", error);

    d3.select("#status")
        .text("Error loading Aid.csv — check Console");
});
