// @refresh reload
import "solid-devtools"
import { mount, StartClient } from "@solidjs/start/client"
import "./app.css"

mount(() => <StartClient />, document.getElementById("app")!)
