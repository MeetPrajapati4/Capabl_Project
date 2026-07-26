import { motion } from 'framer-motion';

/**
 * Individual animated spotlight beam element.
 * Rendered as a framer-motion div so position / rotation can be
 * keyframed declaratively.
 */
function Spotlight({ className = '', ...motionProps }) {
  return (
    <motion.div
      className={`spotlight ${className}`}
      {...motionProps}
    />
  );
}

/**
 * Full-viewport animated spotlight background.
 * Three independently-animated gradient beams drift and rotate behind
 * the main UI content, producing a premium ambient glow effect.
 *
 * Theme-aware — colors are driven by CSS custom properties scoped to
 * `[data-theme]` selectors in App.css.
 */
export default function SpotlightBackground({ children }) {
  return (
    <div className="spotlight-container">
      <div className="spotlight-overlay" aria-hidden="true">
        <Spotlight
          initial={{ x: '-50%', y: '-50%', rotate: '0deg' }}
          animate={{
            x: ['-50%', '-30%', '-70%', '-50%'],
            y: ['-50%', '-70%', '-30%', '-50%'],
            rotate: ['0deg', '15deg', '-15deg', '0deg'],
          }}
          transition={{
            duration: 12,
            ease: 'easeInOut',
            repeat: Infinity,
            repeatType: 'mirror',
          }}
          className="spotlight-left"
        />

        <Spotlight
          initial={{ x: '0%', y: '0%', rotate: '0deg' }}
          animate={{
            x: ['0%', '20%', '-20%', '0%'],
            y: ['0%', '30%', '10%', '0%'],
            rotate: ['-20deg', '0deg', '20deg', '-20deg'],
          }}
          transition={{
            duration: 15,
            ease: 'easeInOut',
            repeat: Infinity,
            repeatType: 'mirror',
            delay: 3,
          }}
          className="spotlight-mid"
        />

        <Spotlight
          initial={{ x: '0%', y: '0%', rotate: '10deg' }}
          animate={{
            x: ['0%', '-30%', '10%', '0%'],
            y: ['0%', '-20%', '20%', '0%'],
            rotate: ['10deg', '-10deg', '25deg', '10deg'],
          }}
          transition={{
            duration: 18,
            ease: 'easeInOut',
            repeat: Infinity,
            repeatType: 'mirror',
            delay: 5,
          }}
          className="spotlight-right"
        />
      </div>

      <div className="spotlight-content">
        {children}
      </div>
    </div>
  );
}
