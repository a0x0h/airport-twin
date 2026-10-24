# Mashhad Airport Twin

A Sims-style digital twin of Mashhad International Airport (MHD, Shahid Hashemi Nejad), built for a simulation course. Every passenger, bag, taxi and parked car is driven by one seeded discrete-event simulation, so a seed always replays the same week.

## What it simulates

- **Departures:** curb drop-off under the MHD canopy, check-in, security lanes with blocking and a shared officer pool, and duty-free, café and prayer-room dwell. Then gate holdrooms, boarding and missed flights.
- **Arrivals:** every aircraft unloads before it turns round. Passengers walk to a carousel and wait for their own bag, clear customs, then meet a greeter, take a pick-up car or join the taxi rank (a double-ended queue).
- **Parking:** P1, a 96-bay car park across the road, used by greeters, by drivers seeing passengers off and by long-stay travellers. A full car park shuts its barrier, cars queue on the road, and drivers who find the queue backed up drive on.
- **Time:** a day and week clock with time-of-day lighting. Demand follows an hourly and weekday profile. The timeline scrubs back and forth through the run.

## Two designs

**MHD today** and a **proposed** design run on the same engine:

- Self bag-drop and smart security lanes.
- E-gates at boarding.
- A faster first bag.
- A taxi holding lot.
- P1 kept for short stay, with bay guidance and ticketless exit.

The **Lab** (`#/lab`) runs paired replications in Web Workers and reports 95% confidence intervals for each metric.

## Pages

| Route | What |
| --- | --- |
| `#/hall` | The live twin. Zone tabs: All, Curb, Check-in, Security, Gates, Arrivals, Parking, Airside. |
| `#/lab` | Design experiments. |
| `#/kit` | Catalog of the fabricated 3D objects. |

## Run

```bash
npm install
npm run dev
```

Stack: Vite, React 19, TypeScript, @react-three/fiber and drei, three.js, zustand.

## Releases

- **0.9:** P1 car park with its own simulation.
- **0.8:** arrivals, baggage claim, greeters and the taxi rank; phone layout.
- **0.7:** design comparison and Lab, mood and crowding overlays.
- **0.1–0.6:** object kit, check-in, security, gates and boarding, Mashhad detail.

## Real days at MHD (v0.9)

1. Get a free key: subscribe to the **Basic** plan of AeroDataBox on RapidAPI.
2. Create `.env.local` here with `RAPIDAPI_KEY=your-key` (git-ignored).
3. `npm run fetch:mhd` records yesterday (Tehran time). Pass `2026-10-21` for one day, or two dates for a range.
   Files land in `public/data/mhd/`; METAR weather (aviationweather.gov, no key) is included.
4. In the twin, **Terminal → Data → Flights** switches between the synthetic schedule and recorded days. The Lab uses the same choice.

Google Maps "Popular times" has no API: copy the bar heights (0–100) by hand into
`public/data/mhd/popular-times.csv`. The **Crowding vs Google** chart compares its shape with the simulation's.
