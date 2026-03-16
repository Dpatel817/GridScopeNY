import plotly.graph_objects as go
from plotly.colors import sample_colorscale

# ------------------------------------------------------------------
# 1) Approximate NYISO zonal polygons (lon, lat)
#    These are starter shapes meant to visually mimic the NYISO map.
#    Replace with exact GeoJSON later if you want production accuracy.
# ------------------------------------------------------------------
ZONE_POLYGONS = {
    "A": [(-79.80, 42.35), (-79.80, 43.32), (-78.15, 43.35), (-78.05, 42.00), (-79.65, 41.95)],
    "B": [(-78.25, 42.30), (-78.25, 43.35), (-77.20, 43.38), (-77.05, 42.15), (-78.10, 42.05)],
    "C": [(-78.15, 42.00), (-77.05, 42.15), (-75.25, 42.25), (-74.95, 43.35), (-77.20, 43.38), (-78.25, 43.35)],
    "D": [(-75.55, 43.75), (-74.75, 44.75), (-73.05, 45.00), (-73.30, 43.95), (-74.25, 43.45)],
    "E": [(-75.35, 42.20), (-74.95, 43.35), (-75.55, 43.75), (-74.25, 43.45), (-73.95, 42.10), (-74.85, 41.75)],
    "F": [(-73.95, 42.10), (-74.25, 43.45), (-73.30, 43.95), (-72.85, 43.00), (-72.95, 42.10)],
    "G": [(-74.85, 41.75), (-73.95, 42.10), (-72.95, 42.10), (-72.95, 41.10), (-73.70, 40.90)],
    "H": [(-73.70, 41.10), (-73.35, 41.10), (-73.25, 40.88), (-73.55, 40.78)],
    "I": [(-73.47, 40.90), (-73.17, 40.90), (-73.08, 40.75), (-73.38, 40.70)],
    "J": [(-74.20, 40.92), (-73.70, 40.92), (-73.70, 40.50), (-74.08, 40.48), (-74.25, 40.70)],
    "K": [(-73.95, 40.88), (-71.85, 40.88), (-71.85, 41.18), (-72.45, 41.25), (-73.35, 41.10), (-73.55, 40.95)],
}

# Label positions
ZONE_CENTROIDS = {
    "A": (-78.95, 42.75),
    "B": (-77.70, 42.85),
    "C": (-76.55, 42.75),
    "D": (-73.70, 44.55),
    "E": (-74.75, 43.10),
    "F": (-73.45, 42.55),
    "G": (-73.45, 41.45),
    "H": (-73.45, 40.97),
    "I": (-73.26, 40.80),
    "J": (-73.95, 40.72),
    "K": (-72.85, 40.92),
}

# ------------------------------------------------------------------
# 2) Example real-time LBMP data
#    Replace this dict with your live zonal LMP feed.
# ------------------------------------------------------------------
zonal_lbmp = {
    "A": 22.41,
    "B": 34.20,
    "C": 41.10,
    "D": 39.90,
    "E": 40.26,
    "F": 40.61,
    "G": 41.29,
    "H": 41.57,
    "I": 41.77,
    "J": 42.04,
    "K": 42.25,
}

# ------------------------------------------------------------------
# 3) Build Plotly map
# ------------------------------------------------------------------
def build_nyiso_zonal_heatmap(lmp_dict, colorscale="RdYlGn_r", title="NYISO Zonal LBMP Heatmap"):
    vals = list(lmp_dict.values())
    vmin, vmax = min(vals), max(vals)

    fig = go.Figure()

    # zone polygons
    for zone, polygon in ZONE_POLYGONS.items():
        value = lmp_dict.get(zone, None)
        if value is None:
            fillcolor = "lightgray"
            hover = f"Zone {zone}<br>No data"
        else:
            norm = 0.5 if vmax == vmin else (value - vmin) / (vmax - vmin)
            fillcolor = sample_colorscale(colorscale, [norm])[0]
            hover = f"Zone {zone}<br>LBMP: ${value:.2f}/MWh"

        lons = [p[0] for p in polygon] + [polygon[0][0]]
        lats = [p[1] for p in polygon] + [polygon[0][1]]

        fig.add_trace(
            go.Scattergeo(
                lon=lons,
                lat=lats,
                mode="lines",
                fill="toself",
                fillcolor=fillcolor,
                line=dict(color="black", width=1.2),
                hoverinfo="text",
                text=hover,
                name=zone,
                showlegend=False,
            )
        )

    # zone labels
    fig.add_trace(
        go.Scattergeo(
            lon=[ZONE_CENTROIDS[z][0] for z in ZONE_CENTROIDS],
            lat=[ZONE_CENTROIDS[z][1] for z in ZONE_CENTROIDS],
            text=[f"{z}<br>${lmp_dict[z]:.2f}" if z in lmp_dict else z for z in ZONE_CENTROIDS],
            mode="text",
            showlegend=False,
            hoverinfo="skip",
            textfont=dict(size=11, color="black"),
        )
    )

    fig.update_geos(
        scope="usa",
        projection_type="mercator",
        fitbounds="locations",
        visible=False,
        showcountries=False,
        showcoastlines=False,
        showsubunits=False,
        lataxis_range=[40.3, 45.2],
        lonaxis_range=[-80.2, -71.5],
    )

    fig.update_layout(
        title=title,
        margin=dict(l=10, r=10, t=50, b=10),
        paper_bgcolor="white",
        plot_bgcolor="white",
        width=950,
        height=700,
    )

    return fig

fig = build_nyiso_zonal_heatmap(zonal_lbmp, title="Real-Time NYISO Zonal LBMP")
fig.show()