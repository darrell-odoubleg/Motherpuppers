// Starting checklists, transcribed from the paper sheets in /root/tmp/motherpuppers.
// Only used to fill an empty database; after that, edit tasks from the Admin page.

const S5 = ['OPEN', 'EARLY', 'MID', 'LATE', 'CLOSE'];
const ONE = ['Done'];
const BEG_MID = ['BEGINNING', 'MIDDLE'];
const JAN_JUL = [1, 7];

// t(label, note, boxes, months) — months limits a task to those calendar months.
const t = (label, note = '', boxes = ONE, months = null) => ({ label, note, boxes, months });

const AREAS = [
  {
    name: 'Bathroom & Grooming',
    sections: [
      { period: 'daily', title: 'Daily', tasks: [
        t('Light Off / Door Closed', '', S5),
        t('Organize', '', S5),
        t('Check Sink is Clean', '', S5),
        t('Check Toilet is Clean', 'Clean if needed', S5),
        t('Vacuum', 'Clean roller / canister / charge battery', S5),
        t('Mop', '', S5),
        t('Names on Board for Incoming Grooming', '', ['MID or LATE']),
      ] },
      { period: 'weekly', title: 'Dust', tasks: [
        t('Cabinets'),
        t('Ceiling / Light / Vent / Walls'),
      ] },
      { period: 'weekly', title: 'Clean', tasks: [
        t('Baseboards', 'Edges / corners'),
        t('Door / Frame / Handle'),
        t('Light Switch & Wall Plates'),
        t('Mirror', 'Remove H2O spots'),
        t('Walls', 'Including both sides of toilet'),
        t('GROOM: Shade / Track / Window'),
      ] },
      { period: 'weekly', title: 'Clean / Organize (only your space)', tasks: [
        t('Cubby – Drawer – Fridge Space', '', ['Black', 'Blue', 'Orange', 'Pink', 'Red']),
      ] },
      { period: 'weekly', title: 'Sunday', tasks: [
        t('Empty Trash', 'Replace bag if needed'),
        t('Take Trash to Blue Can'),
      ] },
      { period: 'weekly', title: 'Monday', tasks: [
        t('Hand Towel', 'Replace'),
      ] },
      { period: 'monthly', title: 'Charge', tasks: [
        t('Purple Training Collar'),
        t('Black Training Collar'),
        t('Controller'),
      ] },
      { period: 'monthly', title: 'Clean (move brown cabinet)', tasks: [
        t('Window / Screen / Track / Shade / Vent', 'January & July', ONE, JAN_JUL),
      ] },
      { period: 'monthly', title: 'Faucet', note: 'Use dedicated zip-lock – tie on faucet – soak 20 min – reuse in Prep & Grooming before emptying & keep bag', tasks: [
        t('Soak w/ Vinegar Water'),
      ] },
      { period: 'monthly', title: 'Change Calendar (new month)', tasks: [
        t('Grooming'),
      ] },
      { period: 'monthly', title: 'Grooming Vent (need tall ladder)', tasks: [
        t('Grooming Vent', 'January & July', ONE, JAN_JUL),
      ] },
    ],
  },
  {
    name: 'Kennel',
    sections: [
      { period: 'daily', title: 'Daily', note: 'When moving stackable kennel – UNLOCK THE WHEELS – don’t drag on floor', tasks: [
        t('South Window: Shade & Window (K5)', '', ['OPEN – AM', 'LOCKED/CLOSED – PM']),
        t('De-Humidifier', 'Empty / wipe down / clean filter', ['OPEN', 'MID', 'CLOSE']),
        t('Kennels Ready', 'Clipboards / PPW / bedding / etc.', S5),
        t('In-Use Baskets Have Cards', 'Attached / updated', S5),
        t('Empty Baskets Are Clean', '', S5),
        t('Bedding Organized', 'Not chaos', S5),
        t('White Boards Filled Out', 'In order / updated', S5),
        t('Vacuum', 'Clean roller / canister / charge battery', S5),
        t('Mop', '', S5),
        t('Clean Floor Drains / Covers / Strainer (K5 & K6)', '', S5),
        t('Clean Scale', '', ['EARLY', 'CLOSE']),
        t('Complete: Microchips / Pictures / Weights', '', ['MID', 'CLOSE']),
        t('North Window: Locked & Shade Closed (Scale)', '', ['LOCKED/CLOSED – AM', 'LOCKED/CLOSED – PM']),
        t('Filter In Attic', 'Green light solid – secure tape if needed', ['MID']),
        t('Lights', '', ['OPEN – ON', 'CLOSE – OFF']),
        t('Remove ALL D/C & Night Waters', '', ['LATE', 'CLOSE']),
        t('Pick-Up: Rugs / Dividers / Kennel Covers', 'Covers so dogs don’t chew them', ['CLOSE']),
        t('Secure ALL Kennels for the Night', 'Doors closed / T-PINs in', ['LATE', 'CLOSE']),
        t('ALL Items Picked-Up & Put Away', '', ['EARLY', 'MID', 'LATE', 'CLOSE']),
        t('Doors Shut/Locked & Lights Off', '', ['LATE', 'CLOSE']),
      ] },
      { period: 'weekly', title: 'Dust', tasks: [
        t('Ceiling / Lights / Vents / Walls'),
        t('Vent Above K6'),
        t('Wire Shelves'),
        t('Window Shades', 'Scale & K5'),
      ] },
      { period: 'weekly', title: 'Clean', tasks: [
        t('Baseboards', 'Edges / corners'),
        t('Box Fan', 'Pull apart – if in use'),
        t('Door / Frame / Handle'),
        t('Dry Erasers', 'Caution: don’t tear erasers'),
        t('Light Switch & Wall Covers'),
        t('Vent Above K6', 'Replace filter'),
        t('Clean Filter', 'Vac / rinse – air dry / put away'),
        t('Walls'),
        t('Wire Shelves'),
        t('Window & Sills', 'Both sides – K5 & K6'),
      ] },
      { period: 'weekly', title: 'Drains: K5 & K6', tasks: [
        t('Run H2O Down 3–5 Minutes'),
      ] },
      { period: 'monthly', title: 'Check / Clean / Replace', tasks: [
        t('Filters In Attic', 'Big & small'),
      ] },
      { period: 'monthly', title: 'De-Humidifier (full clean)', tasks: [
        t('Remove Filter', 'Wipe down inside area – be cautious'),
        t('Remove Drawer', 'Take apart'),
        t('Wipe Down Unit', 'Inside / outside / cord / etc.'),
        t('Unscrew Cap: Remove H2O & Slime Build-up'),
        t('Remove Hair Build-Up in Wheels'),
      ] },
      { period: 'monthly', title: 'Dust & Mop', tasks: [
        t('Under Kennels', '', BEG_MID),
      ] },
      { period: 'monthly', title: 'Clean', tasks: [
        t('Vents', 'Need tall ladder – January & July', ONE, JAN_JUL),
      ] },
      { period: 'monthly', title: 'Kennel Clean Protocol', note: 'Protocol below & hose hanging in closet', tasks: [
        t('Wire / Ledges / Latches / Walls / Basket / Drain', 'Kennels', ['1', '2', '3', '4', '5', '6', '7', '8']),
      ] },
      { period: 'info', title: 'Kennel Drain Cleaning Procedure', note: [
        'This procedure must be completed after kennel(s) have been cleaned. The process uses water flushing to remove hair, food debris, and other materials from the drain system.',
        '## Equipment Needed',
        '- Dedicated hose (hanging in tub closet)',
        '## Preparation',
        '- Complete all kennel cleaning first before beginning drain maintenance',
        '- Use designated hose',
        '## Drain Cleaning Process (repeat for each kennel, starting with Kennel 1)',
        '1. Insert hose into drain — push hose down into drain as far as it will go; snake it through to reach maximum depth',
        '2. Initial flush — turn on water; let water run 1–2 minutes OR until water running into floor drain is completely clear and no debris is visible (hair, food, or other materials)',
        '3. Progressive withdrawal — pull hose back 2–3 inches; repeat until hose end is completely out of drain',
        '4. Move to next kennel — proceed to Kennel 2 and repeat; continue through Kennels 3, 4, 5, 6, 7, and 8',
        '## Quality Check',
        'At each position, water must run clear with no visible debris running into drains before moving to the next position or kennel. Do not rush this process — proper flushing prevents clogs and maintains drain function.',
      ].join('\n'), tasks: [] },
    ],
  },
  {
    name: 'Lobby',
    sections: [
      { period: 'daily', title: '6AM Worker', tasks: [
        t('OPEN: Far Right Window & Shade (6”)'),
        t('Air Purifier ON', 'High setting'),
        t('Shake Rug Outside', 'Away from building'),
        t('Vacuum', 'Clean roller / canister / charge battery'),
        t('Mop'),
      ] },
      { period: 'daily', title: 'Front Staff Morning', note: '@ END OF YOUR SHIFT – CLOSE OUT TILL', tasks: [
        t('Refill', 'Cards / treats / pamphlets / printer'),
        t('Clean iPad & CC Screen'),
        t('Clean / Check Windows & Door', 'Nose / fingerprints'),
        t('Wipe Down Countertop'),
        t('Shades: Open', 'Mon–Fri @ 7:30am / Sat @ 11am / Sun @ 3pm'),
        t('Check:', '', ['EMAIL', 'TASKS', 'VOICEMAIL']),
        t('Set Out Dogs / Inflatable / Open Flags', '10 mins before open – no Sunday'),
        t('Turn on Lights'),
        t('Count Till', 'Make sure correct for YOUR shift'),
        t('Sweep Front Entrance', 'Sidewalk & mats'),
        t('Clean Debris on Flagpole & Dog Yard Turf'),
      ] },
      { period: 'daily', title: 'Throughout Day', tasks: [
        t('Vacuum & Mop', 'Clean roller / canister / charge battery', ['1', '2', '3']),
        t('Clean Windows & Doors', '', ['1', '2', '3']),
        t('Send Vaccination Requests', '', ['1', '2', '3']),
        t('Organize / Straighten Shelves', '', ['1', '2', '3']),
      ] },
      { period: 'daily', title: 'Front Staff Closing', tasks: [
        t('Bring in Dogs / Inflatable / Open Flags'),
        t('Check: Trash by Flagpole & Poop Bag Holder'),
        t('LOCK Windows & CLOSE Shades'),
        t('Incoming Names: Lobby & Grooming'),
        t('Straighten Counter & Shelves'),
        t('Till: Close Out & Lock'),
        t('Log out of Computer & iPad'),
        t('Vacuum', 'Clean roller / canister / charge battery'),
        t('Mop'),
        t('GROOMING: Clear Cleaning Board'),
        t('GROOMING: Mark off Calendar Day'),
        t('Turn Off Light'),
        t('Lock Front Door'),
      ] },
      { period: 'weekly', title: 'Dust', tasks: [
        t('Ceiling / Vents / Lights / Walls'),
        t('Pictures'),
        t('Shelves'),
        t('Tops of Treat Containers'),
        t('Window Shades'),
      ] },
      { period: 'weekly', title: 'Clean', tasks: [
        t('Baseboards', 'Edges / corners'),
        t('Chairs', 'Legs / wheels'),
        t('Computer Mice'),
        t('Doors / Frames / Handles'),
        t('Erasers', 'Don’t tear erasers'),
        t('Phone'),
        t('Walls'),
        t('Wall Plates'),
      ] },
      { period: 'weekly', title: 'Monday', tasks: [
        t('Check iPad Power'),
        t('Check M/C Power', 'Charge if needed'),
        t('Water Plants'),
        t('Rotate Treats'),
      ] },
      { period: 'weekly', title: 'Saturday', tasks: [
        t('Check Mail'),
      ] },
      { period: 'weekly', title: 'Sunday', tasks: [
        t('New Joke'),
      ] },
      { period: 'monthly', title: 'Clean', tasks: [
        t('Air Purifier', 'Take apart / blow out filter'),
        t('Cupboards / Shelves', 'Bars & feet'),
        t('Window Tracks / Screens'),
        t('Yard Dogs', 'Wipe down – no pressure washer'),
        t('Vents', 'Need tall ladder – January & July', ONE, JAN_JUL),
      ] },
      { period: 'monthly', title: 'Pull Next Month’s Arrival PPW', note: '15th–20th of month', tasks: [
        t('Arrival PPW', '', ['Basket Card', 'F.C.', 'Paperwork']),
      ] },
      { period: 'monthly', title: 'Additional', tasks: [
        t('Change Calendar', 'New month'),
      ] },
    ],
  },
  {
    name: 'Outside Yards',
    sections: [
      { period: 'daily', title: 'Daily', tasks: [
        t('Pick-Up Trash & Debris', 'Including breezeway', ['BAY 1', 'B.W.', 'BAY 2', 'BAY 3', 'ALL']),
        t('Check Turf Edges & Fencing', 'Including breezeway', ['BAY 1', 'B.W.', 'BAY 2', 'BAY 3', 'ALL']),
        t('Move: Toys / Pool / Etc.', '', S5),
        t('Spray: Bays / Toys / Fence Lines', '', S5),
        t('Fresh H2O Soaking Bucket', 'Filled ½ way', S5),
        t('Hose Rolled Up / H2O Off', 'DISCONNECT when below 35°', S5),
        t('Rake / Scoop Free from Feces', 'Do NOT leave in H2O', S5),
        t('Sweep Back Deck', '', S5),
        t('Check / Change Poop Bag', 'Take to main trash', S5),
        t('Gates Closed When NOT In Use or Windy', '', S5),
        t('Check Outdoor Décor', 'In yard & on fence', S5),
        t('Everything Complete & Ready for Next Shift', '', ['CLOSE']),
      ] },
      { period: 'daily', season: 'summer', title: 'Daily – Summer', note: 'Emptying pools – CAUTION not to crack edges', tasks: [
        t('POOLS: Clean / Refill', 'Empty / secure @ night', ['FILL', 'MID', 'EMPTY']),
        t('Water Flowers', '', ['EARLY', 'LATE']),
      ] },
      { period: 'daily', season: 'winter', title: 'Daily – Winter (Shovel / Snowplow / Sweep)', note: 'All walks / pathways must remain clear of snow & ice – do NOT pile snow close to entryways or gates. Use pressure washer when needed.', tasks: [
        t('Sidewalk / Flagpole / Dog Décor Yard / Parking Blocks', '', S5),
        t('Back Deck / Breezeway', '', S5),
        t('Bay 1 / Bay 2 / Bay 3', '', S5),
        t('Move Snow Away from Fence Line', 'To melt when needed', S5),
        t('Charge Snowblower Battery', 'If in use', S5),
      ] },
      { period: 'weekly', title: 'Clean Inside & Outside – Use Soap', tasks: [
        t('Poop Swivel Bucket'),
        t('Soaking Bucket'),
      ] },
      { period: 'weekly', title: 'Yards', tasks: [
        t('Dog Poop Clean-Up', 'Outside fence'),
        t('Clean Fence', 'Use scrubber in closet & or rag – move storage cabinet / buckets / etc. (not big one)', ['BAY 1', 'BAY 2', 'BAY 3', 'BREEZEWAY', 'FRONT']),
        t('PE-51 Turf Cleaner', 'See turf cleaner protocol below', ['Bay 1', 'Bay 2', 'Bay 3']),
        t('Vacuum Storage Box / Cabinet', 'Breezeway'),
        t('Water w/ Sprinkler', 'Run @ least 30–45 mins per area', ['Bay 1 · 1st ½', 'Bay 1 · 2nd ½', 'Bay 2 · 1st ½', 'Bay 2 · 2nd ½', 'Bay 3 · 1st ⅓', 'Bay 3 · 2nd ⅓', 'Bay 3 · 3rd ⅓']),
      ] },
      { period: 'monthly', title: 'Weed Removal', tasks: [
        t('Fenced Area', 'Inside Bay 1'),
        t('Between Flag & Fence', 'Rock area'),
        t('Building-to-Parking Blocks'),
        t('Parking Lot to 10th Ave'),
      ] },
      { period: 'monthly', title: 'Monday PM or Tuesday AM', note: 'Needs to be done before more trash goes in', tasks: [
        t('Full Clean Blue Trash Can', 'Walmart side'),
      ] },
      { period: 'monthly', title: 'Debris / Poop / Trash – Clean-Up', tasks: [
        t('Front', 'MP to street', BEG_MID),
        t('E. Side', 'Walmart', BEG_MID),
        t('W. Side', 'Lithia', BEG_MID),
        t('Back Field', '', BEG_MID),
      ] },
      { period: 'info', title: 'Turf Cleaner Application Instructions', note: [
        '## Preparation',
        '- Best time to apply: early morning or later evening',
        '- Cooler temps = slower evaporation = cleaner works longer/better',
        '## Application Steps',
        '1. Fill cleaner bottle first — pour cleaner from gallon jug into cleaner bottle before hooking up to hose',
        '2. Pre-wet turf — water or spray each bay first to get surface wet before applying cleaner',
        '3. Hook up cleaner bottle — attach filled cleaner bottle directly to hose',
        '4. Spray each bay thoroughly — make sure to work cleaner into turf evenly',
        '5. Coverage per bay: use 1–1½ cleaner bottles per bay',
        '6. Pay special attention to fence lines — get along edges well, as those areas tend to collect the most buildup',
        '## Key Tips',
        '- The longer turf stays wet, the better the cleaner performs — don’t rush it',
        '- Apply during cooler parts of the day (AM or PM) to maximize dwell time',
        '- See Tammie for additional questions on usage or technique',
      ].join('\n'), tasks: [] },
    ],
  },
  {
    name: 'Prep Room',
    sections: [
      { period: 'daily', title: 'Daily', tasks: [
        t('Dishes', 'Wash / dry / put away', S5),
        t('Prep Food', 'Kennel order on cart', S5),
        t('Organize / Straighten', 'Including cupboards', S5),
        t('Laundry: Remove Hairballs / Fold / Put Away', '', S5),
        t('Walking Board', 'Names in kennel order', S5),
        t('Washer: Clean Blue Seal', 'Remove hair build-up – CAUTION not to tear / puncture seal', S5),
        t('Clean Sink Faucet & Drain / Closet Tub & Drain', '', S5),
        t('Vacuum', 'Clean roller / canister / charge battery', S5),
        t('Mop', 'Replace mop head / empty & refill when needed', ['OPEN', 'EARLY', 'MID', 'CLOSE']),
        t('Clean Window', 'Both sides', ['OPEN', 'CLOSE']),
        t('Wireless Phone', '', ['OPEN – OUTSIDE', 'CLOSED – INSIDE']),
        t('Refill Cleaners', 'Including tiny cups / mop & H2O spray', ['OPEN', 'CLOSE']),
        t('Closet Light', '', ['OPEN – OFF', 'CLOSED – ON']),
        t('Porch Light', '', ['OPEN – OFF', 'CLOSED – OFF']),
        t('Pick-Up Rug / Laundry Basket', '', ['CLOSE']),
        t('Mark Off Calendar Day', '', ['CLOSE']),
        t('Maxwell Puppers 2.0', 'Clean: roller / wheel / dust bin', ['CLOSE']),
        t('Everything Complete & Ready for Next Shift', '', ['CLOSE']),
        t('Reset ALL Lists & Walking Board', 'Text TLO list picture before reset', ['CLOSE']),
        t('DOORS SHUT TIGHT / LOCKED & Lights Off', '', ['CLOSE']),
      ] },
      { period: 'weekly', title: 'Dust', tasks: [
        t('Ceiling / Lights / Vent / Walls'),
        t('TV', 'Front / back'),
        t('Fridge', 'Behind microwave'),
        t('Microwave', 'Get under'),
        t('Phone'),
        t('Closet Door'),
        t('Water Tank', 'Top / sides'),
        t('Washer & Dryer'),
      ] },
      { period: 'weekly', title: 'Wash / Wipe Down', tasks: [
        t('Cabinets'),
        t('Door / Frame / Handle'),
        t('Food Cart'),
        t('Laundry Basket'),
        t('Walls'),
      ] },
      { period: 'weekly', title: 'Clean', tasks: [
        t('Baskets on Shelf'),
        t('Baseboards', 'Edges / corners'),
        t('Black Marks on Floor'),
        t('Marker Erasers', 'Don’t tear erasers'),
        t('Trash Can & Lid'),
        t('Wall Covers'),
      ] },
      { period: 'weekly', title: 'Monday', tasks: [
        t('Clean Fridge / Microwave'),
        t('Replace Towels', 'Bath / sink / mop'),
      ] },
      { period: 'weekly', title: 'Wednesday', tasks: [
        t('Blowout Vacuum / Hose'),
        t('Blowout Maxwell Puppers'),
      ] },
      { period: 'weekly', title: 'Sunday', tasks: [
        t('Blowout Vacuum / Hose'),
        t('Blowout Maxwell Puppers'),
        t('Wash Rugs', 'Hang dry'),
      ] },
      { period: 'monthly', title: 'Washer', tasks: [
        t('Clean', '1 tab', BEG_MID),
        t('Drain', '', BEG_MID),
      ] },
      { period: 'monthly', title: 'Clean', tasks: [
        t('Closet', 'Walls / tub / H2O tank'),
        t('Mop Bucket', 'Inside / outside'),
        t('Mop Handle / Base'),
        t('Step Ladder'),
        t('Vent', 'Need tall ladder – January & July', ONE, JAN_JUL),
      ] },
      { period: 'monthly', title: 'Change', tasks: [
        t('Calendar', 'New month'),
        t('Sponge', 'Feb / Apr / Jun / Aug / Oct / Dec', ONE, [2, 4, 6, 8, 10, 12]),
      ] },
    ],
  },
];

function seed(db) {
  if (db.prepare('SELECT COUNT(*) n FROM areas').get().n) return;
  const insArea = db.prepare('INSERT INTO areas (name, sort) VALUES (?, ?)');
  const insSec = db.prepare('INSERT INTO sections (area_id, period, season, title, note, sort) VALUES (?, ?, ?, ?, ?, ?)');
  const insTask = db.prepare('INSERT INTO tasks (section_id, label, note, boxes, months, sort) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    AREAS.forEach((a, ai) => {
      const areaId = insArea.run(a.name, ai).lastInsertRowid;
      a.sections.forEach((s, si) => {
        const secId = insSec.run(areaId, s.period, s.season || null, s.title, s.note || '', si).lastInsertRowid;
        s.tasks.forEach((tk, ti) => {
          insTask.run(secId, tk.label, tk.note, JSON.stringify(tk.boxes), tk.months ? JSON.stringify(tk.months) : null, ti);
        });
      });
    });
  })();
}

module.exports = { seed };
