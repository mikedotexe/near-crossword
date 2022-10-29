import React, { useState, useRef, useEffect } from 'react'
import { generateLayout } from 'crossword-layout-generator'
import Crossword from 'react-crossword/dist/es/Crossword'
import { mungeLocalCrossword } from '../utils'
import { ThemeProvider } from 'styled-components'
import { addNewPuzzle } from '../add-puzzle'

const CrosswordForm = ({ contractName }) => {
  const blankClue = { clue: "", answer: "" }
  const [clueAnswerArray, setClueAnswerArray] = useState([blankClue])
  const [dimensions, setDimensions] = useState()
  const [generatedLayout, setGeneratedLayout] = useState()
  const [crosswordLayout, setCrosswordLayout] = useState()
  const [prizeDeposit, setPrizeDeposit] = useState('5')
  const [hasErrors, setHasErrors] = useState(false)
  const crosswordRef = useRef(null)

  const handleClueAnswerChange = (e, key, propName) => {
    //absolutely no spaces allowed, they break answer_pk generation. replace with empty string
    if (propName === "answer" && e.target.value.includes(" ")) {
      e.target.value = e.target.value.replace(" ", "")
    }
    // regex in match whitelists letters, digits, underscore, period, and hyphen
    // also disallows leading _ which seems to break answer_pk
    if (propName === "answer") {
      if (!e.target.value.match(/^[a-zA-Z0-9.-]?[a-zA-Z0-9_.-]*$/)) {
        e.target.classList.add("field-with-errors")
        setHasErrors(true)
      }
      else if (hasErrors) {
        e.target.classList.remove("field-with-errors")
        setHasErrors(false)
      }
    }
    const updatedArray = [...clueAnswerArray]
    updatedArray[key][propName] = e.target.value
    setClueAnswerArray(updatedArray)
  }

  const handleClueAnswerBlur = (e) => {
    // indicate error on fields that have less than 3 characters, but still allow sample puzzle generation
    if (e.target.value.length < 3) {
      e.target.classList.add("field-with-errors")
    } else if (e.target.classList.contains("field-with-errors")) {
      e.target.classList.remove("field-with-errors")
    }
  }

  const handlePrizeDepositChange = (e) => {
    if (e.target.value >= 5 ) {
      setPrizeDeposit(e.target.value)
    }
  }

  const generateSamplePuzzle = () => {
    const filteredClueAnswers =  JSON.parse(JSON.stringify(clueAnswerArray.filter(ca => ca.answer.length > 2 && ca.clue.length > 2)))
    if (filteredClueAnswers.length >= 3 ) {
      const layout = generateLayout(filteredClueAnswers)
      const answers = []
      layout.result.map(value => {
        const answerObj = {
          'num': value.position,
          'start': {
            'x': value.startx,
            'y': value.starty
          },
          'direction': value.orientation,
          'length': value.answer.length,
          'answer': value.answer,
          'clue': value.clue
        }
        if (answerObj.num) {
          answers.push(answerObj)
        }
      })
      setDimensions({
        x: layout.cols,
        y: layout.rows
      })
      setGeneratedLayout(answers)
      setCrosswordLayout(mungeLocalCrossword(answers))
    }
  }

  useEffect(() => {
    if (crosswordRef.current) {
      crosswordRef.current.fillAllAnswers()
      return () => {
        crosswordRef.current.reset()
      }
    }
  }, [crosswordLayout])

  const macroCosm = document.getElementById('macrocosm');
  const macroCosmAgainDude = document.getElementById('even-more-macro');
  let addClassName = "crossword-form";
  macroCosm.classList.add(addClassName);
  macroCosmAgainDude.classList.add(addClassName);
  let removeClassName = "crossword-intro"
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);
  removeClassName = "no-crosswords"
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);
  removeClassName = "crossword-won"
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);
  removeClassName = "crossword-success"
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);

  return (
    <div id="make-crossword">
      <form className="crossword-form" onSubmit={(e) => e.preventDefault()}>

        {/* display if fewer than 3 valid clue answer pairs */}
        { JSON.parse(JSON.stringify(clueAnswerArray.filter(ca => ca.answer.length > 2 && ca.clue.length > 2))).length < 3 &&
          <div className="form-text">Please add at least 3 clues and answers. (Note: this form only works for select, NEAR Shitzu members only)</div>
        }

        {
          clueAnswerArray.map((value, key) => {
            return (
              <div className="clue-answer-item field-group" key={key}>
                <input
                  type="text"
                  onChange={(e) => handleClueAnswerChange(e, key, 'clue')}
                  onBlur={(e) => handleClueAnswerBlur(e)}
                  name={`clue-${key}`}
                  value={value.clue}
                  placeholder="clue: not alice but"
                />
                <input
                  type="text"
                  onChange={(e) => handleClueAnswerChange(e, key, 'answer')}
                  onBlur={(e) => handleClueAnswerBlur(e)}
                  name={`answer-${key}`}
                  value={value.answer}
                  placeholder="answer: bob"
                />
              </div>
            )
          })
        }

        <div className="field-group add-word-container">
          <button
            className="btn"
            onClick={() => setClueAnswerArray([...clueAnswerArray, blankClue])}
          >+ Add Word</button>
        </div>

        { hasErrors &&
          <div className="error-msg">Disallowed characters detected in your form. Allowed characters are letters, numbers, hyphens, periods, and underscores (underscores not allowed as first character)</div>
        }

        { JSON.parse(JSON.stringify(clueAnswerArray.filter(ca => ca.answer.length > 2 && ca.clue.length > 2))).length >= 3 && !hasErrors &&
          <React.Fragment>
            <div className="field-group field-group-border-top">
              <button
                className="win-button"
                onClick={() => generateSamplePuzzle()}
              >Generate Sample Puzzle</button>
            </div>
          </React.Fragment>
        }

        <div id="hurry">
          Sample crossword…
          <div className="puzzle">
            { crosswordLayout &&
              <ThemeProvider
                theme={{
                  columnBreakpoint   : '9999px',
                  gridBackground     : '#fff',
                  cellBackground     : '#D5D5D5',
                  cellBorder         : '#D5D5D5',
                  textColor          : '#000000',
                  numberColor        : 'pink',
                  focusBackground    : 'rgba(170, 208, 85, 0.5)',
                  highlightBackground: 'rgba(255, 200, 96, 0.5)',
                }}
              >
                <Crossword ref={crosswordRef} data={crosswordLayout} useStorage={false} />
              </ThemeProvider>
            }
          </div>
          <div className="reward">
            { crosswordLayout && generatedLayout && dimensions && !hasErrors &&

              <React.Fragment>
                <div className="field-group field-group-border-top">
                  <label htmlFor="prize-field"> Include prize (in NEAR):</label>

                  <input
                    type="number"
                    id="prize-field"
                    value={prizeDeposit}
                    step="1"
                    onChange={(e) => handlePrizeDepositChange(e)}
                  />
                </div>

                <div className="field-group">
                  <button
                    className="win-button"
                    onClick={() => addNewPuzzle(crosswordLayout, generatedLayout, dimensions, prizeDeposit, contractName)}
                  >Create puzzle!</button>
                </div>
              </React.Fragment>

            }
          </div>
        </div>

      </form>
    </div>
  )
}

export default CrosswordForm
