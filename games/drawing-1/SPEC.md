# Cat's Sunny Way Home

Goal: Play the cat. Collect all 5 little suns, then reach the door of the house on the right to win.
Controls: Left/Right (A/D or arrows in JSON input as left/right) to run, Jump (jump) to leap onto trees, Action/Restart (action) to restart after winning or losing. A timer (90 seconds) and 3 lives count down; the patrolling car knocks the cat back and costs a life on a side hit (landing on top of the car is safe). Lose when lives reach 0 or time runs out.
On screen: sky, grass, the house goal on the right, three trees whose leafy tops are platforms, five floating suns to collect, the drivable-looking car patrolling the ground, the cat player, and a HUD with suns, lives and time.

## Art objects (player drawings, used as-is)
- cat: the player character (runs, jumps, can be knocked back)
- sun: the five collectibles (small spinning suns); collecting all unlocks the house
- tree: three platform trees - stand on their canopies to climb and reach high suns
- house: the goal home on the right; enter its door after collecting all suns to win
- car: a patrolling hazard on the ground (pushable physics body); side hits cost a life, you can ride/stand on its roof
