import { Calligraph } from "calligraph";
import { useReducedMotion } from "framer-motion";

const accessibleText = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

export default function FluidText({ children, className, as = "span" }) {
  const Component = as;
  const reduceMotion = useReducedMotion();
  const text = String(children ?? "");

  if (reduceMotion) return <Component className={className}>{text}</Component>;

  return (
    <Component className={className}>
      <span style={accessibleText}>{text}</span>
      <Calligraph
        aria-hidden="true"
        animation="smooth"
        initial={false}
        autoSize={false}
        drift={{ x: 8, y: 0 }}
        style={{ display: "inline", whiteSpace: "normal" }}
      >
        {text}
      </Calligraph>
    </Component>
  );
}
