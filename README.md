# Finite State Machine Designer

An interactive web-based tool for designing and visualizing Finite State Machines (FSM). Built with pure HTML5, CSS, and JavaScript - no external dependencies required.

## 🚀 Live Demo

Visit the [FSM Designer](https://mholgatem.github.io/FiniteStateMachine/) to try it out!

## ✨ Features

- **Drag and Drop Interface**: Easily add states by dragging components from the palette onto the canvas
- **Multiple State Types**:
  - Regular states (blue)
  - Start states (green)
  - End/Accept states (red with thick border)
- **Transition Management**: Create transitions between states with custom labels
- **Interactive Editing**:
  - Double-click states to rename them
  - Double-click transitions to edit labels
  - Right-click to delete states or transitions
- **Save/Load Functionality**: Export your FSM design as a JSON file and load it later to continue working
- **Visual Feedback**: Selected states and shift-selected states for transition creation are clearly highlighted

## 📖 How to Use

### Adding States
1. **Drag and drop**: Drag a state type from the left sidebar onto the canvas
2. **Quick add**: Click the "+ Add State" button to add a state at the center

### Creating Transitions
1. Hold **Shift** and click on the source state (it will show a dashed purple border)
2. While still holding **Shift**, click on the destination state
3. A transition arrow will be created between the two states

### Editing
- **Rename a state**: Double-click on any state to edit its name
- **Edit transition label**: Double-click on a transition to change its label
- **Move states**: Click and drag any state to reposition it
- **Delete**: Right-click on a state or transition and confirm deletion

### Save/Load
- **Save**: Click the "Save" button to download your FSM as a JSON file
- **Load**: Click the "Load" button and select a previously saved JSON file

## 🛠️ Local Development

Simply open `index.html` in a web browser. No build process or server required!

```bash
# Clone the repository
git clone https://github.com/mholgatem/FiniteStateMachine.git

# Open in browser
open index.html
# or on Linux
xdg-open index.html
```

## 📁 Project Structure

```
FiniteStateMachine/
├── index.html    # Main HTML structure
├── styles.css    # Styling for the application
├── app.js        # Core JavaScript logic
├── README.md     # This file
└── LICENSE       # MIT License
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
