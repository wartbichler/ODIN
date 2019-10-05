import L from 'leaflet'
import './Corridor'
import { calcStruts, line } from './shapes/geo-helper'
import { svgBuilder } from './shapes/svg-builder'

/**
 *
 */
L.Feature['G*G*OLAA--'] = L.TACGRP.Corridor.extend({
  _shape (group, options) {
    const points = ({ center, envelope }) => {
      const s = calcStruts(center, envelope)([ 0.38 ])

      // Interpolate points for corridor width (half of arrow width)
      // TODO: remove/simplify shape when minimum width is below a certain limit
      const struts = envelope.map(line).slice(1)

      return [[
        ...struts.map(s => s.point(0.25)).reverse(),
        s[0].point(0.75), s[0].point(1),
        center[0],
        s[0].point(0), s[0].point(0.25),
        ...struts.map(s => s.point(0.75))
      ]]
    }

    return svgBuilder(group, options, { points })
  }
})
