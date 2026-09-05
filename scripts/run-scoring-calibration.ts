import { runV3EnergyCalibration } from '../src/lib/scoring/v3/energy-calibration'

const v3Energy = runV3EnergyCalibration()
console.log('v3 Energy calibration evidence')
console.log(v3Energy.report)

if (!v3Energy.ok) process.exitCode = 1
