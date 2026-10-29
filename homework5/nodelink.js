
const width = 1600;
const height = 950;

const svg = d3.select("#chart")
    .attr("viewBox", `0 0 ${width} ${height}`);

const tooltip = d3.select("#tooltip");
const formatAmount = d3.format(",.2f");

svg.selectAll("*").remove();

// Load CSV
d3.csv("Aid.csv", d => ({
    donor: d["Donor name"]?.trim(),
    recipient: d["Recipient name"]?.trim(),
    amount: +d.Amount
})).then(rawData => {

    // Filter invalid or unspecified records
    const data = rawData.filter(d =>
        d.donor &&
        d.recipient &&
        Number.isFinite(d.amount) &&
        d.amount > 0 &&
        !/unspecified/i.test(d.donor) &&
        !/unspecified/i.test(d.recipient)
    );

    // Calculate total aid donated and received
    const donated = d3.rollup(
        data,
        v => d3.sum(v, d => d.amount),
        d => d.donor
    );

    const received = d3.rollup(
        data,
        v => d3.sum(v, d => d.amount),
        d => d.recipient
    );

    // Select top 10 donors and recipients
    const topDonors = Array.from(donated)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(d => d[0]);

    const topRecipients = Array.from(received)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(d => d[0]);

    // One node per country
    const selected = new Set([
        ...topDonors,
        ...topRecipients
    ]);

    const nodes = Array.from(selected, id => ({
        id,
        donated: donated.get(id) || 0,
        received: received.get(id) || 0
    }));

    const nodeById = new Map(
        nodes.map(d => [d.id, d])
    );

    // Aggregate donation relationships
    const grouped = d3.rollup(
        data.filter(d =>
            selected.has(d.donor) &&
            selected.has(d.recipient) &&
            d.donor !== d.recipient
        ),
        v => d3.sum(v, d => d.amount),
        d => d.donor,
        d => d.recipient
    );

    const links = [];

    for (const [donor, recipients] of grouped) {
        for (const [recipient, amount] of recipients) {
            links.push({
                source: donor,
                target: recipient,
                amount
            });
        }
    }

    const activity = d => d.donated + d.received;

    // Node radius
    const radius = d3.scaleSqrt()
        .domain([
            0,
            d3.max(nodes, activity) || 1
        ])
        .range([10, 38]);

    // Edge thickness
    const strokeWidth = d3.scaleSqrt()
        .domain([
            0,
            d3.max(links, d => d.amount) || 1
        ])
        .range([1, 7]);

    // Color according to aid balance
    function nodeColor(d) {
        const total = activity(d);

        if (total === 0) return "#999";

        const balance =
            (d.donated - d.received) / total;

        if (balance > 0.1) return "steelblue";
        if (balance < -0.1) return "orange";

        return "mediumpurple";
    }

    // -----------------------------------
    // STATIC NODE POSITIONING
    // -----------------------------------

    // Separate net donors and net recipients
    const donorNodes = nodes.filter(d =>
        d.donated >= d.received
    );

    const recipientNodes = nodes.filter(d =>
        d.donated < d.received
    );

    donorNodes.sort((a, b) =>
        activity(b) - activity(a)
    );

    recipientNodes.sort((a, b) =>
        activity(b) - activity(a)
    );

    const leftX = 280;
    const rightX = 1320;

    const topMargin = 90;
    const bottomMargin = 90;

    function positionColumn(group, x) {
        const availableHeight =
            height - topMargin - bottomMargin;

        group.forEach((d, i) => {
            d.x = x;
            d.y = topMargin +
                (i + 0.5) *
                availableHeight / group.length;
        });
    }

    positionColumn(donorNodes, leftX);
    positionColumn(recipientNodes, rightX);

    // -----------------------------------
    // REDUCE EDGE CROSSINGS
    // -----------------------------------

    // Build undirected neighbor lists for ordering.
    const neighbors = new Map(
        nodes.map(d => [d.id, []])
    );

    links.forEach(l => {
        neighbors.get(l.source).push({
            id: l.target,
            weight: l.amount
        });

        neighbors.get(l.target).push({
            id: l.source,
            weight: l.amount
        });
    });

    // Sort nodes according to neighboring positions
    function reorder(group, oppositeGroup) {
        const oppositeIDs = new Set(
            oppositeGroup.map(d => d.id)
        );

        const previousPosition = new Map(
            group.map((d, i) => [d.id, i])
        );

        group.forEach(d => {
            const connected = neighbors.get(d.id)
                .filter(n => oppositeIDs.has(n.id));

            if (connected.length === 0) {
                d.orderScore = d.y;
                return;
            }

            // Weighted average neighbor position
            const totalWeight = d3.sum(
                connected, n => n.weight
            );

            d.orderScore = d3.sum(
                connected,
                n => nodeById.get(n.id).y * n.weight
            ) / totalWeight;
        });

        group.sort((a, b) =>
            a.orderScore - b.orderScore ||
            previousPosition.get(a.id) -
            previousPosition.get(b.id)
        );
    }

    // Repeated deterministic ordering
    for (let i = 0; i < 8; i++) {
        reorder(recipientNodes, donorNodes);
        positionColumn(recipientNodes, rightX);

        reorder(donorNodes, recipientNodes);
        positionColumn(donorNodes, leftX);
    }

    // -----------------------------------
    // DRAW EDGES
    // -----------------------------------

    const defs = svg.append("defs");

    defs.append("marker")
        .attr("id", "aid-arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 10)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .attr("markerUnits", "userSpaceOnUse")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#888");

    // Find whether a reverse relationship exists
    const linkKeys = new Set(
        links.map(d => `${d.source}\u0000${d.target}`)
    );

    function edgePath(d) {
        const source = nodeById.get(d.source);
        const target = nodeById.get(d.target);

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.hypot(dx, dy);

        if (distance === 0) return "";

        const ux = dx / distance;
        const uy = dy / distance;

        // Stop links at node boundaries
        const startX = source.x +
            ux * (radius(activity(source)) + 2);

        const startY = source.y +
            uy * (radius(activity(source)) + 2);

        const endX = target.x -
            ux * (radius(activity(target)) + 4);

        const endY = target.y -
            uy * (radius(activity(target)) + 4);

        const mx = (startX + endX) / 2;
        const my = (startY + endY) / 2;

        const hasReverse = linkKeys.has(
            `${d.target}\u0000${d.source}`
        );

        // Use stronger curvature for same-column edges.
        const sameColumn =
            Math.abs(source.x - target.x) < 1;

        let offset = 0;

        if (sameColumn) {
            // Route same-column links away from the center.
            offset = source.x === leftX ? -110 : 110;
        } else if (hasReverse) {
            // Bend reciprocal links to separate them.
            offset = 45;
        } else {
            offset = 15;
        }

        // Perpendicular control point
        const cx = mx - uy * offset;
        const cy = my + ux * offset;

        return `M${startX},${startY}
                Q${cx},${cy} ${endX},${endY}`;
    }

    const link = svg.append("g")
        .attr("class", "links")
        .selectAll("path")
        .data(links)
        .join("path")
        .attr("d", edgePath)
        .attr("fill", "none")
        .attr("stroke", "#888")
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", d =>
            strokeWidth(d.amount)
        )
        .attr("marker-end", "url(#aid-arrow)");

    // -----------------------------------
    // DRAW NODES
    // -----------------------------------

    const node = svg.append("g")
        .attr("class", "nodes")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", d => radius(activity(d)))
        .attr("fill", nodeColor)
        .attr("stroke", "white")
        .attr("stroke-width", 2)
        .style("cursor", "pointer");

    // Node labels
    const label = svg.append("g")
        .attr("class", "labels")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .text(d => d.id)
        .attr("x", d => d.x)
        .attr("y", d =>
            d.y - radius(activity(d)) - 9
        )
        .attr("text-anchor", "middle")
        .attr("font-size", 14)
        .attr("font-weight", 500)
        .attr("fill", "#333")
        .attr("pointer-events", "none");

    // -----------------------------------
    // INTERACTION
    // -----------------------------------

    node.on("mouseover", (event, d) => {

        tooltip
            .style("opacity", 1)
            .html(`
                <strong>${d.id}</strong><br>
                Donated: ${formatAmount(d.donated)}<br>
                Received: ${formatAmount(d.received)}<br>
                Total activity: ${formatAmount(activity(d))}
            `);

        // Highlight connected edges
        link
            .attr("stroke-opacity", l =>
                l.source === d.id ||
                l.target === d.id ? 0.9 : 0.04
            )
            .attr("stroke", l =>
                l.source === d.id ||
                l.target === d.id
                    ? "#2563eb"
                    : "#888"
            );

        // Fade unrelated nodes
        const connectedIDs = new Set([d.id]);

        neighbors.get(d.id).forEach(n =>
            connectedIDs.add(n.id)
        );

        node.attr("opacity", n =>
            connectedIDs.has(n.id) ? 1 : 0.2
        );

        label.attr("opacity", n =>
            connectedIDs.has(n.id) ? 1 : 0.2
        );
    })
    .on("mousemove", event => {
        tooltip
            .style("left", `${event.pageX + 15}px`)
            .style("top", `${event.pageY + 15}px`);
    })
    .on("mouseout", () => {

        tooltip.style("opacity", 0);

        link
            .attr("stroke-opacity", 0.35)
            .attr("stroke", "#888");

        node.attr("opacity", 1);
        label.attr("opacity", 1);
    });

    // -----------------------------------
    // COLUMN HEADINGS
    // -----------------------------------

    svg.append("text")
        .attr("x", leftX)
        .attr("y", 35)
        .attr("text-anchor", "middle")
        .attr("font-size", 23)
        .attr("font-weight", "bold")
        .attr("fill", "steelblue")
        .text("Net Donors");

    svg.append("text")
        .attr("x", rightX)
        .attr("y", 35)
        .attr("text-anchor", "middle")
        .attr("font-size", 23)
        .attr("font-weight", "bold")
        .attr("fill", "orange")
        .text("Net Recipients");

    console.log("Static graph rendered");
    console.log("Nodes:", nodes.length);
    console.log("Links:", links.length);

}).catch(error => {
    console.error("Error loading Aid.csv:", error);
});
